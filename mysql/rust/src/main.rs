use std::process::ExitCode;

use database_mcp_rs_core::run;
use database_mcp_rs_mysql::MysqlAdapter;

fn main() -> ExitCode {
    run::<MysqlAdapter>(env!("CARGO_PKG_VERSION"))
}
