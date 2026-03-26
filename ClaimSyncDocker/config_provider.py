# config_provider.py
# ClaimSync Phase 0 — Configuration Provider Abstraction
#
# Purpose:
#   Decouples config loading from the main script.
#   Phase 0: LocalINIProvider reads shafafiaapi.ini (identical to raw configparser).
#   Phase 2: DBConfigProvider will read from Azure SQL tenant table — zero changes
#             needed in main() or mainsub() when that swap happens.
#
# Usage in main():
#   provider = LocalINIProvider('shafafiaapi.ini')
#   config   = provider.get_main_config()
#   # config['shafaapi-main']['active'] etc. — identical to configparser usage
#
# Change History:
#   v1.0  Anbu  11-Mar-2026  Phase 0 initial — ABC + LocalINIProvider + DBConfigProvider stub

import configparser
import os
from abc import ABC, abstractmethod


class ConfigProvider(ABC):
    """
    Abstract base class for ClaimSync configuration providers.
    Concrete implementations return a ConfigParser-compatible mapping object
    so all config['section']['key'] accesses in main()/mainsub() are unchanged.
    """

    @abstractmethod
    def get_main_config(self) -> configparser.ConfigParser:
        """
        Load and return the full configuration as a ConfigParser object.
        Raises FileNotFoundError or a provider-specific error if config is unavailable.
        """
        raise NotImplementedError


class LocalINIProvider(ConfigProvider):
    """
    Phase 0 provider — reads configuration from a local .ini file.
    Direct replacement for the raw configparser.ConfigParser() + config.read()
    block that was in main().

    Args:
        ini_path (str): Path to the .ini file (e.g. 'shafafiaapi.ini').
    """

    def __init__(self, ini_path: str):
        self._ini_path = ini_path

    def get_main_config(self) -> configparser.ConfigParser:
        """
        Reads the ini file and returns a populated ConfigParser.

        Raises:
            FileNotFoundError: if the ini file does not exist.
        """
        if not os.path.exists(self._ini_path):
            raise FileNotFoundError(
                f"ConfigProvider: INI file not found: {self._ini_path}"
            )
        config = configparser.ConfigParser()
        config.read(self._ini_path)
        return config


class DBConfigProvider(ConfigProvider):
    """
    Phase 2 stub — will read tenant configuration from Azure SQL.
    Not yet implemented. Raises NotImplementedError if called.

    When implemented, get_main_config() will:
      1. Connect to Azure SQL using a managed identity or Key Vault secret.
      2. Query the tenants table for the given tenant_id.
      3. Build and return a ConfigParser-compatible object populated from DB rows.
         All config['section']['key'] accesses in main()/mainsub() remain unchanged.

    Args:
        tenant_id (str): The tenant identifier (facility code or UUID).
        db_conn_str (str): Azure SQL connection string (injected from Key Vault in Phase 2).
    """

    def __init__(self, tenant_id: str, db_conn_str: str = ''):
        self._tenant_id  = tenant_id
        self._db_conn_str = db_conn_str

    def get_main_config(self) -> configparser.ConfigParser:
        # TODO Phase 2: implement DB-backed config loading
        raise NotImplementedError(
            f"DBConfigProvider is not yet implemented. "
            f"tenant_id={self._tenant_id}"
        )
