//! MariaDB shares MySQL's wire protocol, driver, and information_schema;
//! the adapter is the MySQL one with the engine label and env names changed.

use std::process::ExitCode;

use database_mcp_rs_core::{EnvNames, run};
use database_mcp_rs_mysql::{Flavor, MysqlAdapter};

struct Mariadb;

impl Flavor for Mariadb {
    const ENGINE: &'static str = "mariadb";
    const ENV: EnvNames = EnvNames {
        prefix: "MARIADB",
        dsn_var: Some("MARIADB_DSN"),
        password_var: None,
    };
}

fn main() -> ExitCode {
    run::<MysqlAdapter<Mariadb>>(env!("CARGO_PKG_VERSION"))
}
