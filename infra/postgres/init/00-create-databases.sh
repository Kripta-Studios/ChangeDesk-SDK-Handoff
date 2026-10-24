#!/bin/sh
set -eu

psql --set ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set changedesk_migrator_password="$CHANGEDESK_MIGRATOR_PASSWORD" \
  --set changedesk_runtime_password="$CHANGEDESK_RUNTIME_PASSWORD" \
  --set changedesk_worker_password="$CHANGEDESK_WORKER_PASSWORD" \
  --set atlas_password="$ATLAS_DB_PASSWORD" \
  --set boreal_password="$BOREAL_DB_PASSWORD" <<-'EOSQL'
CREATE ROLE changedesk_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'changedesk_migrator_password';
CREATE ROLE changedesk_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'changedesk_runtime_password';
CREATE ROLE changedesk_worker LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'changedesk_worker_password';
CREATE ROLE atlas_owner LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'atlas_password';
CREATE ROLE boreal_owner LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'boreal_password';
EOSQL

createdb --username "$POSTGRES_USER" --owner changedesk_migrator changedesk
createdb --username "$POSTGRES_USER" --owner atlas_owner atlas
createdb --username "$POSTGRES_USER" --owner boreal_owner boreal

psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'EOSQL'
REVOKE CONNECT ON DATABASE changedesk FROM PUBLIC;
REVOKE CONNECT ON DATABASE atlas FROM PUBLIC;
REVOKE CONNECT ON DATABASE boreal FROM PUBLIC;
GRANT CONNECT ON DATABASE changedesk TO changedesk_migrator, changedesk_runtime, changedesk_worker;
GRANT CONNECT ON DATABASE atlas TO atlas_owner;
GRANT CONNECT ON DATABASE boreal TO boreal_owner;
EOSQL

