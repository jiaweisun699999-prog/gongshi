#!/bin/sh
set -eu
umask 077
install -d -m 700 /var/backups/gongshi
/opt/gongshi/bin/node --input-type=module -e '
import { DatabaseSync, backup } from "node:sqlite";
const db = new DatabaseSync("/var/lib/gongshi/reviews.sqlite", { readOnly: true });
const name = new Date().toISOString().replace(/[:.]/g, "-");
await backup(db, "/var/backups/gongshi/" + name + ".sqlite");
db.close();
'
find /var/backups/gongshi -maxdepth 1 -type f -name '*.sqlite' -mtime +14 -delete
