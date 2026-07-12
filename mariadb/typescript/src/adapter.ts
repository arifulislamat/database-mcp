import { MysqlAdapter } from "@database-mcp/mysql";

/**
 * MariaDB is MySQL wire-compatible: same driver (mysql2), same
 * information_schema introspection, same session read-only enforcement.
 * Quirk overrides go here if any surface; conformance decides.
 */
export class MariadbAdapter extends MysqlAdapter {
  override engine = "mariadb";
}
