/* Oracle stub — hal pins are plain heap doubles here (see ../README.md) */
#ifndef ORACLE_STUB_HAL_H
#define ORACLE_STUB_HAL_H
#include <stdlib.h>
#include <stdbool.h>
typedef double hal_float_t;
#define HAL_IN 16
#define HAL_OUT 32
static inline void *hal_malloc(long size) { return calloc(1, (size_t)size); }
static inline int hal_pin_float_newf(int dir, hal_float_t **ptr, int comp_id,
                                     const char *fmt, ...) {
  (void)dir; (void)comp_id; (void)fmt;
  *ptr = (hal_float_t *)calloc(1, sizeof(hal_float_t));
  return *ptr ? 0 : -1;
}

/* Newer handle-style pin API (master-era comps, e.g. xyzacb_trsrn.comp):
 * hal_real_t/hal_bool_t are opaque handles upstream; here a handle is a
 * pointer to a heap value, so hal_get_real/hal_set_bool read/write
 * through it and the comp's per-call pin reads behave identically. */
typedef double *hal_real_t;
typedef bool *hal_bool_t;
static inline int hal_pin_new_real(int comp_id, int dir, hal_real_t *h,
                                   double init, const char *fmt, ...) {
  (void)comp_id; (void)dir; (void)fmt;
  *h = (double *)calloc(1, sizeof(double));
  if (!*h) return -1;
  **h = init;
  return 0;
}
static inline int hal_pin_new_bool(int comp_id, int dir, hal_bool_t *h,
                                   int init, const char *fmt, ...) {
  (void)comp_id; (void)dir; (void)fmt;
  *h = (bool *)calloc(1, sizeof(bool));
  if (!*h) return -1;
  **h = (bool)init;
  return 0;
}
static inline double hal_get_real(hal_real_t h) { return *h; }
static inline void hal_set_real(hal_real_t h, double v) { *h = v; }
static inline void hal_set_bool(hal_bool_t h, int v) { *h = (bool)v; }
static inline int hal_set_unready(int comp_id) { (void)comp_id; return 0; }
static inline int hal_ready(int comp_id) { (void)comp_id; return 0; }
#endif
