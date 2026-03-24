import logging
from typing import Optional

from core.database import db_fetch_one, db_execute, db_execute_delete

logger = logging.getLogger(__name__)


class SettingsManager:
    """Manages application settings stored in the database."""

    async def get_setting(self, key: str) -> Optional[str]:
        """Get a setting value by key. Returns None if not found."""
        row = await db_fetch_one(
            "SELECT value FROM settings WHERE key = ?", (key,)
        )
        return row["value"] if row else None

    async def set_setting(self, key: str, value: str) -> None:
        """Create or update a setting."""
        await db_execute(
            "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
            (key, value)
        )

    async def delete_setting(self, key: str) -> bool:
        """Delete a setting by key. Returns True if a row was deleted."""
        rowcount = await db_execute_delete("DELETE FROM settings WHERE key = ?", (key,))
        return rowcount > 0


# Global instance
settings_manager = SettingsManager()
