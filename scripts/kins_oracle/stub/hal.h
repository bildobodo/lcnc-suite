/* Oracle stub — hal pins are plain heap doubles here (see ../README.md) */
#ifndef ORACLE_STUB_HAL_H
#define ORACLE_STUB_HAL_H
#include <stdlib.h>
typedef double hal_float_t;
#define HAL_IN 16
static inline void *hal_malloc(long size) { return calloc(1, (size_t)size); }
static inline int hal_pin_float_newf(int dir, hal_float_t **ptr, int comp_id,
                                     const char *fmt, ...) {
  (void)dir; (void)comp_id; (void)fmt;
  *ptr = (hal_float_t *)calloc(1, sizeof(hal_float_t));
  return *ptr ? 0 : -1;
}
#endif
