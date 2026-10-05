/* Standalone diagnostic: no TE2 runtime or worker lifecycle actions. */
#include <Python.h>
#include <stdio.h>

int main(int argc, char **argv) {
    if (argc != 3) {
        fprintf(stderr, "usage: probe-python-embedding BASE_PREFIX VENV_PYTHON\n");
        return 2;
    }
    PyConfig config;
    PyConfig_InitPythonConfig(&config);
    config.use_environment = 0;
    config.parse_argv = 0;
    PyStatus status = PyConfig_SetBytesString(&config, &config.home, argv[1]);
    if (!PyStatus_Exception(status)) {
        status = PyConfig_SetBytesString(&config, &config.program_name, argv[2]);
    }
    if (!PyStatus_Exception(status)) {
        status = Py_InitializeFromConfig(&config);
    }
    if (PyStatus_Exception(status)) {
        fprintf(stderr, "embedding failed: %s\n", status.err_msg ? status.err_msg : "unknown");
        PyConfig_Clear(&config);
        return 1;
    }
    PyConfig_Clear(&config);
    int result = PyRun_SimpleString(
        "import json,sys,sysconfig,math,_ssl,_sqlite3,zlib\n"
        "assert sys.version_info[:2] == (3,14)\n"
        "assert not sysconfig.get_config_var('Py_GIL_DISABLED')\n"
        "print(json.dumps({'version':sys.version,'prefix':sys.prefix,"
        "'basePrefix':sys.base_prefix,'executable':sys.executable,"
        "'soabi':sysconfig.get_config_var('SOABI'),"
        "'stdlibExtensions':'math,_ssl,_sqlite3,zlib imported'}))\n"
    );
    if (Py_FinalizeEx() < 0) return 120;
    return result == 0 ? 0 : 1;
}
