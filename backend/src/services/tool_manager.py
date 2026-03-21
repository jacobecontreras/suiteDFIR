"""
Tool Manager for suiteDFIR
Manages paths to vendored iLEAPP/aLEAPP forensic tools.
"""

import logging
from pathlib import Path
from typing import Optional, Dict, Any

from core.config import TOOLS_CONFIG, TOOLS_DIR

logger = logging.getLogger(__name__)


class ToolManager:
    """Manages paths to vendored forensic tools."""

    def __init__(self):
        self.tools_dir = Path(TOOLS_DIR)
        # Ensure tools directory exists
        self.tools_dir.mkdir(parents=True, exist_ok=True)

    def get_tool_path(self, tool_name: str) -> Optional[Path]:
        """
        Get the path to a vendored tool.

        Args:
            tool_name: 'ileapp' or 'aleapp'

        Returns:
            Path to tool directory, or None if tool not found
        """
        if tool_name not in TOOLS_CONFIG:
            logger.warning(f"Unknown tool requested: {tool_name}")
            return None

        config = TOOLS_CONFIG[tool_name]
        tool_subdir = config.get("subdir", tool_name)
        tool_path = self.tools_dir / "leapp-tools" / tool_subdir

        if tool_path.exists():
            return tool_path

        logger.error(f"Tool not found at expected path: {tool_path}")
        return None

    def check_tools_status(self) -> Dict[str, Any]:
        """
        Check availability of all configured tools.

        Returns:
            Dict mapping tool names to their status info
        """
        status = {}

        for tool_name, config in TOOLS_CONFIG.items():
            tool_path = self.get_tool_path(tool_name)

            status[tool_name] = {
                "name": config["name"],
                "description": config["description"],
                "installed": tool_path is not None,
                "path": str(tool_path) if tool_path else None,
                "version": "vendored",  # Tools are vendored, version controlled by git
                "installed_at": None,   # N/A for vendored tools
            }

        return status


# Global instance
tool_manager = ToolManager()
