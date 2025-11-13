# app/apps/file_editor_cm6/stores.py

"""
Module to hold singleton instances of data stores.
This prevents circular dependencies between main.py and other modules that need access to the stores.
"""

from .history_store import HistoryStore
from .preferences_store import PreferencesStore

# Initialize singleton instances
_history_store = HistoryStore()
_preferences_store = PreferencesStore()
