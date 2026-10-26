#include "../ffi/te2_probe.h"
#include <stdio.h>
#include <string.h>

int main(void) {
    const char *label = "c-fixture";
    uint8_t output[4096];
    size_t written = 0;
    if (te2_probe_abi_version() != 1) return 2;
    int32_t status = te2_probe_run_v1((const uint8_t *)label, strlen(label),
                                    output, sizeof(output), &written);
    if (status != 0 || written > sizeof(output)) return 3;
    if (fwrite(output, 1, written, stdout) != written) return 4;
    return putchar('\n') == EOF ? 5 : 0;
}
