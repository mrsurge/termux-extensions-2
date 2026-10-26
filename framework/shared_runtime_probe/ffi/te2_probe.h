#ifndef TE2_PROBE_H
#define TE2_PROBE_H
#include <stddef.h>
#include <stdint.h>

uint32_t te2_probe_abi_version(void);
/* ABI v1: UTF-8 label <=128 bytes, caller-owned non-overlapping buffers.
 * written receives byte length (required length on -2). No implicit retry.
 * Returns 0 success, 1 operation error, -1 invalid, -2 capacity, -3 panic.
 * On invalid arguments no output buffer/written value is promised.
 */
int32_t te2_probe_run_v1(const uint8_t *label, size_t label_len,
                       uint8_t *output, size_t capacity, size_t *written);
#endif
