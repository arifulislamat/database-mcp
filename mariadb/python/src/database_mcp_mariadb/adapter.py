"""MariaDB shares MySQL's wire protocol, driver, and information_schema;
the adapter is the MySQL one with the engine label changed."""

from database_mcp_mysql import MysqlAdapter


class MariadbAdapter(MysqlAdapter):
    engine = "mariadb"
