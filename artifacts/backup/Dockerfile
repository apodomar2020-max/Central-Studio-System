FROM postgres:18-bookworm

RUN apt-get update \
  && apt-get install --yes --no-install-recommends age ca-certificates python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/central-studio-backup
COPY backup.py ./backup.py

USER postgres

ENTRYPOINT ["python3", "/opt/central-studio-backup/backup.py"]
