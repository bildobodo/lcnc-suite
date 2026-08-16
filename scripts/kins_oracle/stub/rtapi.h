/* Oracle stub — rtapi prints go to stderr (see ../README.md) */
#ifndef ORACLE_STUB_RTAPI_H
#define ORACLE_STUB_RTAPI_H
#include <stdio.h>
#include <stdarg.h>
#define RTAPI_MSG_ERR 1
static inline void rtapi_print_msg(int level, const char *fmt, ...) {
  (void)level; va_list ap; va_start(ap, fmt); vfprintf(stderr, fmt, ap); va_end(ap);
}
static inline void rtapi_print(const char *fmt, ...) {
  va_list ap; va_start(ap, fmt); vfprintf(stderr, fmt, ap); va_end(ap);
}
#endif
