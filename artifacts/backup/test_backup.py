import datetime as dt
import unittest

from backup import (
    BACKUP_MARKER,
    SafeFailure,
    choose_retention,
    filename_for,
    validate_recipient,
)


UTC = dt.timezone.utc


def record(file_id: str, timestamp: dt.datetime, *, verified: bool = True):
    return {
        "id": file_id,
        "name": filename_for(timestamp),
        "trashed": False,
        "appProperties": {
            "backupMarker": BACKUP_MARKER,
            "backupTimestamp": timestamp.isoformat().replace("+00:00", "Z"),
            "verificationState": "verified" if verified else "pending",
        },
    }


class BackupPolicyTests(unittest.TestCase):
    def test_filename_is_deterministic_and_contains_no_identifiers(self):
        timestamp = dt.datetime(2026, 8, 27, 2, 0, 1, tzinfo=UTC)
        self.assertEqual(
            filename_for(timestamp),
            "central-studio-production-20260827-020001.dump.age",
        )

    def test_retention_keeps_seven_daily_and_promotes_four_sundays(self):
        newest = dt.datetime(2026, 8, 27, 2, tzinfo=UTC)
        files = [record(f"day-{days}", newest - dt.timedelta(days=days)) for days in range(35)]

        keep, delete = choose_retention(files)

        newest_seven = {f"day-{days}" for days in range(7)}
        four_sundays = {
            f"day-{days}"
            for days in [
                days
                for days in range(35)
                if (newest - dt.timedelta(days=days)).weekday() == 6
            ][:4]
        }
        self.assertTrue(newest_seven.issubset(keep))
        self.assertTrue(four_sundays.issubset(keep))
        self.assertEqual(len(keep | delete), 35)
        self.assertFalse(keep & delete)

    def test_same_day_retry_keeps_only_newest_daily_copy(self):
        newer = dt.datetime(2026, 8, 27, 4, tzinfo=UTC)
        older = dt.datetime(2026, 8, 27, 2, tzinfo=UTC)
        keep, delete = choose_retention(
            [record("newer", newer), record("older", older)], daily=1, weekly=0
        )
        self.assertEqual(keep, {"newer"})
        self.assertEqual(delete, {"older"})

    def test_pending_and_foreign_files_are_never_retention_deleted(self):
        timestamp = dt.datetime(2026, 8, 27, 2, tzinfo=UTC)
        pending = record("pending", timestamp, verified=False)
        foreign = {"id": "foreign", "name": "notes.txt", "trashed": False}

        keep, delete = choose_retention([pending, foreign], daily=0, weekly=0)

        self.assertEqual(keep, set())
        self.assertEqual(delete, set())

    def test_only_public_age_recipient_is_accepted(self):
        recipient = "age1" + "q" * 58
        self.assertEqual(validate_recipient(recipient), recipient)
        with self.assertRaises(SafeFailure):
            validate_recipient("AGE-SECRET-KEY-1EXAMPLE")


if __name__ == "__main__":
    unittest.main()
