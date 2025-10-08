# app/utils/optional_import.py
import importlib, types, traceback

class MissingModule(types.SimpleNamespace):
    def __init__(self, name, err):
        super().__init__(__missing__=True, __name__=name, __error__=repr(err), __trace__=traceback.format_exc())

def optional_import(name: str):
    try:
        return importlib.import_module(name)
    except BaseException as e:
        return MissingModule(name, e)
