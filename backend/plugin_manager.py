import os
import sys
import gc
import logging
import contextlib
from config import TOOLS_CONFIG
from state import plugin_loaders, available_modules

logger = logging.getLogger(__name__)

@contextlib.contextmanager
def safe_tool_execution(tool_path):
    """
    Context manager to safely execute code within a forensic tool's environment.
    
    Handles:
    1. Modifying sys.path to include the tool
    2. Changing working directory to the tool's directory
    3. Cleaning up sys.modules to prevent conflicts between tools (iLEAPP/aLEAPP)
    4. Restoring original state (cwd, sys.path) after execution
    """
    original_cwd = os.getcwd()
    path_inserted = False
    
    try:
        # 1. Add tool to Python path
        if tool_path not in sys.path:
            sys.path.insert(0, tool_path)
            path_inserted = True

        # 2. Change to tool directory
        os.chdir(tool_path)

        # 3. Clear conflicting modules BEFORE importing
        # This ensures we load a fresh copy for each tool
        modules_to_remove = [
            m for m in sys.modules
            if m == 'scripts' or m.startswith('scripts.')
            or m == 'google' or m.startswith('google.')
            or m == 'protobuf' or m.startswith('protobuf.')
        ]
        for m in modules_to_remove:
            del sys.modules[m]

        # Force garbage collection to clean up any leftover references
        gc.collect()

        yield

    except OSError as e:
        logger.error(f"OS Error during tool execution setup for {tool_path}: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error during tool execution context: {e}")
        raise
    finally:
        # 4. Restore state
        try:
            os.chdir(original_cwd)
        except OSError as e:
            logger.error(f"Failed to restore original working directory {original_cwd}: {e}")
            
        if path_inserted:
            try:
                sys.path.remove(tool_path)
            except ValueError:
                pass # Already removed

def load_plugins():
    """
    Loads forensic tool plugins based on configuration.
    Uses safe_tool_execution to isolate tool environments.
    """
    import sys
    logger.info("=== load_plugins() called ===")
    logger.info(f"sys.frozen: {getattr(sys, 'frozen', False)}")
    
    # Import ToolManager to get actual installed tool paths
    try:
        from tool_manager import tool_manager
        logger.info(f"ToolManager imported, tools_dir: {tool_manager.tools_dir}")
    except ImportError as e:
        tool_manager = None
        logger.warning(f"Failed to import tool_manager: {e}")
    
    for tool_id, config in TOOLS_CONFIG.items():
        try:
            logger.info(f"--- Processing tool: {tool_id} ---")
            
            # Try ToolManager first (for downloaded tools), then fall back to config path
            tool_path = None
            if tool_manager:
                tool_path = tool_manager.get_tool_path(tool_id)
                logger.info(f"ToolManager.get_tool_path('{tool_id}'): {tool_path}")
                if tool_path:
                    tool_path = str(tool_path)
            
            # Fall back to config path (development mode)
            if not tool_path:
                tool_path = config["path"]
                logger.info(f"Using config path: {tool_path}")
            
            if not os.path.exists(tool_path):
                logger.warning(f"{config['name']} path not found: {tool_path}")
                continue

            logger.info(f"Loading {config['name']} modules from {tool_path}...")


            with safe_tool_execution(tool_path):
                # Import plugin_loader from the tool
                # These imports MUST happen inside the context where sys.path is set
                try:
                    import scripts.plugin_loader as plugin_loader
                    import scripts.modules_to_exclude as modules_to_exclude
                    logger.info("Successfully imported scripts.plugin_loader and scripts.modules_to_exclude")
                except ImportError as e:
                    logger.error(f"Failed to import tool scripts: {e}")
                    continue

                # Monkey-patch the plugin_loader to be fault-tolerant
                original_load_plugins = plugin_loader.PluginLoader._load_plugins

                def fault_tolerant_load_plugins(self):
                    """Load plugins but skip problematic ones instead of crashing"""
                    import traceback
                    import sys
                    
                    plugin_files = list(self._plugin_path.glob("*.py"))
                    
                    for py_file in plugin_files:

                        try:
                            mod = plugin_loader.PluginLoader.load_module_lazy(py_file)
                            mod_artifacts = getattr(mod, '__artifacts_v2__', None) or getattr(mod, '__artifacts__', None)
                            if mod_artifacts is None:
                                continue  # no artifacts defined in this plugin

                            version = 2 if '__artifacts_v2__' in dir(mod) else 1  # determine the version

                            for name, artifact in mod_artifacts.items():
                                if version == 2:
                                    category = artifact.get('category')
                                    search = artifact.get('paths')

                                    func = None
                                    # 1. Look for a wrapped function with the name of the dictionary
                                    for item_name in dir(mod):
                                        item = getattr(mod, item_name)
                                        if callable(item) and item_name == name and hasattr(item, '__wrapped__'):
                                            func = item
                                            break

                                    # 2. If no wrapped function, look for declared function
                                    if func is None:
                                        func_name = artifact.get('function')
                                        if func_name:
                                            func = getattr(mod, func_name, None)

                                    # 3. If neither above work, log the failure
                                    if func is None:
                                        print(f"Warning: No matching function found for artifact '{name}' in module '{py_file.stem}'")
                                        continue

                                    # Store the entire artifact dictionary as artifact_info
                                    artifact_info = artifact
                                    if func:
                                        func.artifact_info = artifact_info  # Attach artifact_info to the function

                                else:
                                    # 4. If no v2, then use v1
                                    category, search, func = artifact
                                    artifact_info = {'category': category, 'paths': search}

                                if name in self._plugins:
                                    raise KeyError(f"Duplicate plugin: '{name}' in module '{py_file.stem}'")

                                # Add artifact_info to PluginSpec
                                self._plugins[name] = plugin_loader.PluginSpec(name, py_file.stem, category, search, func, artifact_info)

                        except Exception as e:
                            # Log the error but continue loading other plugins
                            logger.warning(f"Skipping plugin file {py_file.name} due to error: {str(e)[:100]}")
                            continue

                # Replace the load method temporarily
                plugin_loader.PluginLoader._load_plugins = fault_tolerant_load_plugins

                # Load modules with fault-tolerant loader
                loader = plugin_loader.PluginLoader()
                plugin_loaders[tool_id] = loader

                # Restore original method
                plugin_loader.PluginLoader._load_plugins = original_load_plugins

                # Process plugins into a dictionary
                tool_modules = {}
                excluded_modules = config['excluded_modules']

                # loader.plugins is a property that yields from dict values
                for plugin in loader.plugins:
                    if plugin.module_name in excluded_modules:
                        continue

                    # Check if module is enabled in modules_to_exclude
                    plugin_enabled = True
                    if hasattr(modules_to_exclude, 'modules_to_exclude'):
                        plugin_enabled = plugin.module_name not in modules_to_exclude.modules_to_exclude

                    # Get display name
                    plugin_display_name = plugin.name
                    if hasattr(plugin, 'artifact_info'):
                        plugin_display_name = plugin.artifact_info.get('name', plugin.name)

                    tool_modules[plugin.name] = {
                        "name": plugin.name,
                        "category": plugin.category,
                        "display_name": plugin_display_name,
                        "module_name": plugin.module_name,
                        "enabled": plugin_enabled,
                        "selected": plugin_enabled # Default to selected
                    }

                available_modules[tool_id] = tool_modules
                logger.info(f"Loaded {len(tool_modules)} {config['name']} modules")

        except Exception as e:
            logger.error(f"Error loading {config['name']} modules: {e}")

