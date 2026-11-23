#!/usr/bin/env python3
"""Exercise the real invalidation migration in disposable PostgreSQL.

Supabase Auth and the broadcaster are stubbed. This verifies transactionality,
recipient selection and RLS, not the hosted WebSocket service or compatibility
with every historical application migration. No deployed credentials are read.
"""
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase/migrations/20261123120000_realtime_invalidations.sql"
pg_bin = os.environ.get("POSTGRES_BIN", "/opt/homebrew/opt/postgresql@17/bin")

def command(name):
    local = Path(pg_bin) / name
    found = str(local) if local.is_file() else shutil.which(name)
    if not found:
        raise SystemExit(f"Install PostgreSQL or set POSTGRES_BIN ({name} unavailable)")
    return found

with tempfile.TemporaryDirectory(prefix="agjenti-realtime-") as temp:
    base = Path(temp)
    data = base / "data"
    started = False
    def run(args, **kwargs):
        result = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, **kwargs)
        if result.returncode:
            raise RuntimeError(result.stdout)
        return result.stdout
    try:
        run([command("initdb"), "-D", str(data), "-A", "trust", "--no-locale", "--encoding=UTF8"])
        # Unix socket in a unique private directory; no TCP listener or production connection.
        run([command("pg_ctl"), "-D", str(data), "-l", str(base / "server.log"), "-o", f"-k {base} -p 55439 -h ''", "start"])
        started = True
        sql = """
create role authenticated; create role anon; create role service_role;
create schema auth; create schema realtime;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic',true) $$;
create table realtime.messages(topic text,extension text,payload jsonb);
alter table realtime.messages enable row level security;
grant usage on schema auth,realtime to authenticated;
grant select on realtime.messages to authenticated;
create table public.platform_admins(user_id uuid);
create table public.capability_events(agent text,capability text,point text,outcome text,reason text,mode text,business_id uuid);
create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$ insert into realtime.messages values(topic,'broadcast',payload) $$;
"""
        migration = MIGRATION.read_text()
        tables = re.findall(r"\('([a-z_]+)','(?:inbox|transport|reactions|assistant|discovery|training|campaigns|business|access)'\)", migration)
        assert len(tables) > 20, "Trigger inventory missing"
        for table in tables:
            sql += f"create table public.{table}(id uuid default gen_random_uuid(),business_id uuid,user_id uuid,owner_user_id uuid,panel_user_id uuid,conversation_id uuid,operation_kind text,operator_user_id uuid,connection_id uuid,participant_id text,status text,body text,slug text,updated_at timestamptz,leased_until timestamptz,lease_token uuid);\n"
        sql += migration + "\n" + (ROOT / "scripts/realtime/checks.sql").read_text()
        run([command("psql"), "-h", str(base), "-p", "55439", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], input=sql)
        print("PASS: private routing, tenant isolation, revocation, RLS, rollback, idle writes and recorded broadcast failure (provider stubbed)")
    finally:
        if started:
            run([command("pg_ctl"), "-D", str(data), "-m", "fast", "stop"])
