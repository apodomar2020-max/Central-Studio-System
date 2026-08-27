#!/usr/bin/env python3
"""Encrypted, least-privilege PostgreSQL backup job for Railway Cron."""

from __future__ import annotations

import datetime as dt
import hashlib
import http.client
import json
import os
import re
import signal
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


DRIVE_API = "https://www.googleapis.com/drive/v3"
DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3"
FOLDER_MIME = "application/vnd.google-apps.folder"
BACKUP_MIME = "application/octet-stream"
BACKUP_NAME = re.compile(
    r"^central-studio-production-(\d{8})-(\d{6})\.dump\.age$"
)
BACKUP_MARKER = "centralStudioProductionBackup"
EXPECTED_SCOPE = "https://www.googleapis.com/auth/drive.file"


class SafeFailure(Exception):
    """An operational failure whose provider details must never reach logs."""


@dataclass(frozen=True)
class DatabaseConnection:
    host: str
    port: int
    user: str
    password: str
    database: str
    sslmode: str | None


@dataclass(frozen=True)
class BackupRecord:
    file_id: str
    timestamp: dt.datetime
    verified: bool


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def filename_for(timestamp: dt.datetime) -> str:
    return f"central-studio-production-{timestamp:%Y%m%d-%H%M%S}.dump.age"


def parse_database_url(value: str) -> DatabaseConnection:
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise SafeFailure("invalid_database_url")
    if not parsed.hostname or not parsed.username or parsed.password is None:
        raise SafeFailure("invalid_database_url")
    database = urllib.parse.unquote(parsed.path.removeprefix("/"))
    if not database or "/" in database:
        raise SafeFailure("invalid_database_url")
    query = urllib.parse.parse_qs(parsed.query)
    sslmode = query.get("sslmode", [None])[0]
    return DatabaseConnection(
        host=parsed.hostname,
        port=parsed.port or 5432,
        user=urllib.parse.unquote(parsed.username),
        password=urllib.parse.unquote(parsed.password),
        database=database,
        sslmode=sslmode,
    )


def validate_recipient(value: str) -> str:
    recipient = value.strip()
    if not re.fullmatch(r"age1[023456789acdefghjklmnpqrstuvwxyz]{58}", recipient):
        raise SafeFailure("invalid_age_recipient")
    if "AGE-SECRET-KEY" in recipient.upper():
        raise SafeFailure("private_age_identity_forbidden")
    return recipient


def required_environment() -> dict[str, str]:
    required = (
        "BACKUP_DATABASE_URL",
        "AGE_RECIPIENT",
        "GOOGLE_DRIVE_CLIENT_ID",
        "GOOGLE_DRIVE_CLIENT_SECRET",
        "GOOGLE_DRIVE_REFRESH_TOKEN",
        "GOOGLE_DRIVE_BACKUP_FOLDER_ID",
    )
    values = {key: os.environ.get(key, "") for key in required}
    if any(not value for value in values.values()):
        raise SafeFailure("missing_configuration")
    values["AGE_RECIPIENT"] = validate_recipient(values["AGE_RECIPIENT"])
    return values


def safe_subprocess(
    args: list[str], *, env: dict[str, str], timeout: int
) -> None:
    try:
        completed = subprocess.run(
            args,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise SafeFailure("subprocess_failed") from exc
    if completed.returncode != 0:
        raise SafeFailure("subprocess_failed")


def postgres_environment(connection: DatabaseConnection, temp_home: Path) -> dict[str, str]:
    environment = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": str(temp_home),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "PGAPPNAME": "central_studio_encrypted_backup",
        "PGPASSWORD": connection.password,
    }
    if connection.sslmode:
        environment["PGSSLMODE"] = connection.sslmode
    return environment


def postgres_args(connection: DatabaseConnection) -> list[str]:
    return [
        "--host",
        connection.host,
        "--port",
        str(connection.port),
        "--username",
        connection.user,
        "--dbname",
        connection.database,
        "--no-password",
    ]


def create_dump(
    connection: DatabaseConnection, dump_path: Path, temp_home: Path
) -> None:
    safe_subprocess(
        [
            "pg_dump",
            *postgres_args(connection),
            "--format=custom",
            "--no-owner",
            "--no-privileges",
            "--file",
            str(dump_path),
        ],
        env=postgres_environment(connection, temp_home),
        timeout=1800,
    )
    if not dump_path.is_file() or dump_path.stat().st_size <= 0:
        raise SafeFailure("empty_dump")


def verify_dump(dump_path: Path, temp_home: Path) -> None:
    safe_subprocess(
        ["pg_restore", "--list", str(dump_path)],
        env={
            "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
            "HOME": str(temp_home),
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
        },
        timeout=300,
    )


def encrypt_dump(recipient: str, dump_path: Path, encrypted_path: Path) -> None:
    safe_subprocess(
        [
            "age",
            "--recipient",
            recipient,
            "--output",
            str(encrypted_path),
            str(dump_path),
        ],
        env={
            "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
            "HOME": str(dump_path.parent),
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
        },
        timeout=1800,
    )
    if not encrypted_path.is_file() or encrypted_path.stat().st_size <= 0:
        raise SafeFailure("empty_encrypted_backup")


def file_hashes(path: Path) -> tuple[str, str]:
    sha256 = hashlib.sha256()
    md5 = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            sha256.update(chunk)
            md5.update(chunk)
    return sha256.hexdigest(), md5.hexdigest()


def wipe_and_remove(path: Path) -> None:
    if not path.exists() or not path.is_file():
        return
    try:
        size = path.stat().st_size
        with path.open("r+b", buffering=0) as handle:
            zeroes = b"\0" * (1024 * 1024)
            remaining = size
            while remaining > 0:
                count = min(remaining, len(zeroes))
                handle.write(zeroes[:count])
                remaining -= count
            handle.flush()
            os.fsync(handle.fileno())
    finally:
        path.unlink(missing_ok=True)


def parse_backup_record(file: dict[str, Any]) -> BackupRecord | None:
    properties = file.get("appProperties") or {}
    match = BACKUP_NAME.fullmatch(str(file.get("name", "")))
    if (
        not match
        or properties.get("backupMarker") != BACKUP_MARKER
        or not file.get("id")
        or file.get("trashed") is True
    ):
        return None
    timestamp_value = properties.get("backupTimestamp")
    try:
        timestamp = dt.datetime.fromisoformat(timestamp_value.replace("Z", "+00:00"))
    except (AttributeError, TypeError, ValueError):
        return None
    if timestamp.tzinfo is None:
        return None
    return BackupRecord(
        file_id=str(file["id"]),
        timestamp=timestamp.astimezone(dt.timezone.utc),
        verified=properties.get("verificationState") == "verified",
    )


def choose_retention(
    files: Iterable[dict[str, Any]], *, daily: int = 7, weekly: int = 4
) -> tuple[set[str], set[str]]:
    records = [record for item in files if (record := parse_backup_record(item))]
    verified = sorted(
        (record for record in records if record.verified),
        key=lambda record: record.timestamp,
        reverse=True,
    )

    keep: set[str] = set()
    daily_dates: set[dt.date] = set()
    for record in verified:
        backup_date = record.timestamp.date()
        if backup_date in daily_dates:
            continue
        if len(daily_dates) >= daily:
            break
        daily_dates.add(backup_date)
        keep.add(record.file_id)

    weekly_buckets: set[tuple[int, int]] = set()
    for record in verified:
        if record.timestamp.weekday() != 6:
            continue
        iso = record.timestamp.isocalendar()
        bucket = (iso.year, iso.week)
        if bucket in weekly_buckets:
            continue
        if len(weekly_buckets) >= weekly:
            break
        weekly_buckets.add(bucket)
        keep.add(record.file_id)

    delete = {record.file_id for record in verified if record.file_id not in keep}
    return keep, delete


class DriveClient:
    def __init__(self, access_token: str):
        self._access_token = access_token

    def _json(
        self,
        url: str,
        *,
        method: str = "GET",
        body: dict[str, Any] | None = None,
        timeout: int = 60,
    ) -> dict[str, Any]:
        data = json.dumps(body).encode("utf8") if body is not None else None
        headers = {"Authorization": f"Bearer {self._access_token}"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = response.read()
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise SafeFailure("drive_request_failed") from exc
        if not payload:
            return {}
        try:
            return json.loads(payload)
        except json.JSONDecodeError as exc:
            raise SafeFailure("drive_response_invalid") from exc

    def _empty(self, url: str, *, method: str) -> None:
        request = urllib.request.Request(
            url,
            headers={"Authorization": f"Bearer {self._access_token}"},
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                response.read()
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise SafeFailure("drive_request_failed") from exc

    def verify_private_folder(self, folder_id: str) -> None:
        encoded = urllib.parse.quote(folder_id, safe="")
        fields = urllib.parse.quote(
            "id,name,mimeType,trashed,capabilities(canAddChildren)", safe="(),"
        )
        folder = self._json(f"{DRIVE_API}/files/{encoded}?fields={fields}")
        if (
            folder.get("id") != folder_id
            or folder.get("mimeType") != FOLDER_MIME
            or folder.get("trashed") is True
            or folder.get("capabilities", {}).get("canAddChildren") is not True
        ):
            raise SafeFailure("backup_folder_invalid")
        permission_fields = urllib.parse.quote(
            "permissions(type,role,allowFileDiscovery)", safe="(),"
        )
        permissions = self._json(
            f"{DRIVE_API}/files/{encoded}/permissions?fields={permission_fields}"
        ).get("permissions", [])
        if not permissions or any(item.get("type") == "anyone" for item in permissions):
            raise SafeFailure("backup_folder_public")

    def upload_resumable(
        self,
        *,
        folder_id: str,
        file_path: Path,
        filename: str,
        properties: dict[str, str],
    ) -> dict[str, Any]:
        size = file_path.stat().st_size
        fields = urllib.parse.quote(
            "id,name,mimeType,size,md5Checksum,appProperties,parents,trashed",
            safe=",",
        )
        metadata = {
            "name": filename,
            "mimeType": BACKUP_MIME,
            "parents": [folder_id],
            "appProperties": properties,
        }
        request = urllib.request.Request(
            f"{DRIVE_UPLOAD_API}/files?uploadType=resumable&fields={fields}",
            data=json.dumps(metadata).encode("utf8"),
            headers={
                "Authorization": f"Bearer {self._access_token}",
                "Content-Type": "application/json; charset=UTF-8",
                "X-Upload-Content-Type": BACKUP_MIME,
                "X-Upload-Content-Length": str(size),
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                location = response.headers.get("Location")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise SafeFailure("upload_initialization_failed") from exc
        if not location:
            raise SafeFailure("upload_location_missing")

        parsed = urllib.parse.urlsplit(location)
        if parsed.scheme != "https" or not parsed.hostname:
            raise SafeFailure("upload_location_invalid")
        connection = http.client.HTTPSConnection(
            parsed.hostname, parsed.port or 443, timeout=1800
        )
        target = urllib.parse.urlunsplit(("", "", parsed.path, parsed.query, ""))
        try:
            connection.putrequest("PUT", target)
            connection.putheader("Content-Type", BACKUP_MIME)
            connection.putheader("Content-Length", str(size))
            connection.endheaders()
            with file_path.open("rb") as handle:
                while chunk := handle.read(1024 * 1024):
                    connection.send(chunk)
            response = connection.getresponse()
            payload = response.read()
            if response.status not in {200, 201}:
                raise SafeFailure("upload_failed")
        except (OSError, http.client.HTTPException) as exc:
            raise SafeFailure("upload_failed") from exc
        finally:
            connection.close()
        try:
            return json.loads(payload)
        except json.JSONDecodeError as exc:
            raise SafeFailure("upload_response_invalid") from exc

    def get_file(self, file_id: str) -> dict[str, Any]:
        encoded = urllib.parse.quote(file_id, safe="")
        fields = urllib.parse.quote(
            "id,name,mimeType,size,md5Checksum,appProperties,parents,trashed",
            safe=",",
        )
        return self._json(f"{DRIVE_API}/files/{encoded}?fields={fields}")

    def mark_verified(self, file_id: str, properties: dict[str, str]) -> dict[str, Any]:
        encoded = urllib.parse.quote(file_id, safe="")
        fields = urllib.parse.quote(
            "id,name,mimeType,size,md5Checksum,appProperties,parents,trashed",
            safe=",",
        )
        return self._json(
            f"{DRIVE_API}/files/{encoded}?fields={fields}",
            method="PATCH",
            body={"appProperties": properties},
        )

    def list_folder_files(self, folder_id: str) -> list[dict[str, Any]]:
        files: list[dict[str, Any]] = []
        page_token: str | None = None
        while True:
            query = {
                "q": f"'{folder_id}' in parents and trashed = false",
                "spaces": "drive",
                "pageSize": "1000",
                "fields": (
                    "nextPageToken,files(id,name,mimeType,size,md5Checksum,"
                    "appProperties,parents,trashed)"
                ),
            }
            if page_token:
                query["pageToken"] = page_token
            result = self._json(
                f"{DRIVE_API}/files?{urllib.parse.urlencode(query)}"
            )
            files.extend(result.get("files", []))
            page_token = result.get("nextPageToken")
            if not page_token:
                return files

    def delete_file(self, file_id: str) -> None:
        encoded = urllib.parse.quote(file_id, safe="")
        self._empty(f"{DRIVE_API}/files/{encoded}", method="DELETE")


def access_token(config: dict[str, str]) -> str:
    data = urllib.parse.urlencode(
        {
            "client_id": config["GOOGLE_DRIVE_CLIENT_ID"],
            "client_secret": config["GOOGLE_DRIVE_CLIENT_SECRET"],
            "refresh_token": config["GOOGLE_DRIVE_REFRESH_TOKEN"],
            "grant_type": "refresh_token",
        }
    ).encode("ascii")
    request = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.load(response)
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise SafeFailure("oauth_refresh_failed") from exc
    token = payload.get("access_token")
    if not isinstance(token, str) or not token:
        raise SafeFailure("oauth_access_token_missing")
    returned_scope = payload.get("scope")
    if returned_scope and set(returned_scope.split()) != {EXPECTED_SCOPE}:
        raise SafeFailure("oauth_scope_mismatch")
    return token


def verify_remote_file(
    remote: dict[str, Any],
    *,
    file_id: str,
    filename: str,
    folder_id: str,
    size: int,
    sha256: str,
    md5: str,
    state: str,
) -> None:
    properties = remote.get("appProperties") or {}
    if (
        remote.get("id") != file_id
        or remote.get("name") != filename
        or remote.get("mimeType") != BACKUP_MIME
        or remote.get("trashed") is True
        or str(remote.get("size")) != str(size)
        or remote.get("md5Checksum") != md5
        or folder_id not in remote.get("parents", [])
        or properties.get("backupMarker") != BACKUP_MARKER
        or properties.get("checksumSha256") != sha256
        or properties.get("verificationState") != state
    ):
        raise SafeFailure("remote_verification_failed")


def apply_retention(client: DriveClient, folder_id: str) -> str:
    files = client.list_folder_files(folder_id)
    keep, delete = choose_retention(files)
    for file_id in sorted(delete):
        client.delete_file(file_id)
    return f"kept:{len(keep)},deleted:{len(delete)}"


def run_backup() -> int:
    started_at = utc_now()
    started_monotonic = time.monotonic()
    status = "failed_initialization"
    dump_size = 0
    encrypted_size = 0
    checksum_reference = "unavailable"
    retention_outcome = "not_run"
    remote_file_id: str | None = None
    remote_verified = False
    dump_path: Path | None = None
    encrypted_path: Path | None = None

    try:
        config = required_environment()
        connection = parse_database_url(config["BACKUP_DATABASE_URL"])
        folder_id = config["GOOGLE_DRIVE_BACKUP_FOLDER_ID"]
        filename = filename_for(started_at)

        temp_root = Path(tempfile.mkdtemp(prefix="central-backup-"))
        dump_path = temp_root / "database.dump"
        encrypted_path = temp_root / filename

        status = "failed_dump"
        create_dump(connection, dump_path, temp_root)
        dump_size = dump_path.stat().st_size

        status = "failed_integrity_check"
        verify_dump(dump_path, temp_root)

        status = "failed_encryption"
        encrypt_dump(config["AGE_RECIPIENT"], dump_path, encrypted_path)
        encrypted_size = encrypted_path.stat().st_size
        sha256, md5 = file_hashes(encrypted_path)
        checksum_reference = sha256

        status = "failed_oauth"
        client = DriveClient(access_token(config))

        status = "failed_folder_privacy"
        client.verify_private_folder(folder_id)

        properties = {
            "backupMarker": BACKUP_MARKER,
            "backupTimestamp": started_at.isoformat().replace("+00:00", "Z"),
            "checksumSha256": sha256,
            "dumpSizeBytes": str(dump_size),
            "encryptedSizeBytes": str(encrypted_size),
            "verificationState": "pending",
        }
        status = "failed_upload"
        uploaded = client.upload_resumable(
            folder_id=folder_id,
            file_path=encrypted_path,
            filename=filename,
            properties=properties,
        )
        remote_file_id = uploaded.get("id")
        if not remote_file_id:
            raise SafeFailure("uploaded_file_id_missing")

        status = "failed_remote_verification"
        remote = client.get_file(remote_file_id)
        verify_remote_file(
            remote,
            file_id=remote_file_id,
            filename=filename,
            folder_id=folder_id,
            size=encrypted_size,
            sha256=sha256,
            md5=md5,
            state="pending",
        )
        verified_properties = {**properties, "verificationState": "verified"}
        client.mark_verified(remote_file_id, verified_properties)
        verified_remote = client.get_file(remote_file_id)
        verify_remote_file(
            verified_remote,
            file_id=remote_file_id,
            filename=filename,
            folder_id=folder_id,
            size=encrypted_size,
            sha256=sha256,
            md5=md5,
            state="verified",
        )
        remote_verified = True

        status = "failed_retention"
        retention_outcome = apply_retention(client, folder_id)
        status = "success"
    except SafeFailure:
        pass
    except Exception:
        status = "failed_internal"
    finally:
        if remote_file_id and not remote_verified:
            try:
                client.delete_file(remote_file_id)  # type: ignore[possibly-undefined]
            except Exception:
                pass
        for path in (dump_path, encrypted_path):
            if path is not None:
                try:
                    wipe_and_remove(path)
                except Exception:
                    status = "failed_local_cleanup"
        if dump_path is not None:
            shutil.rmtree(dump_path.parent, ignore_errors=True)

    duration = round(time.monotonic() - started_monotonic, 3)
    log = {
        "timestamp": started_at.isoformat().replace("+00:00", "Z"),
        "backup_status": status,
        "dump_size_bytes": dump_size,
        "encrypted_size_bytes": encrypted_size,
        "duration_seconds": duration,
        "checksum_reference": checksum_reference,
        "retention_outcome": retention_outcome,
    }
    print(json.dumps(log, separators=(",", ":")), flush=True)
    return 0 if status == "success" else 1


def _terminate(_signum: int, _frame: Any) -> None:
    raise SafeFailure("terminated")


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, _terminate)
    signal.signal(signal.SIGINT, _terminate)
    sys.exit(run_backup())
