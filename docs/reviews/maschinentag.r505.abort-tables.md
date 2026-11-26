# Measurements (abort-proto.spec.ts)

Window = the scroll window from Setup (`.stripScroll`; today: the whole strip). Stop = the jog Stop whole (13 hit points) at every sample (25 positions, 12 smooth-scroll frames, 6 wheel steps, 4 focus scrolls). Fixed = Safety and Jog one rect over all samples. Last = every scrolled section's last control whole after keyboard focus.


## Strip — today-z100 (today, 100 %, chromium)

| Axes | Window (CSS px) | Safety w | Jog w × h | Window w × h | Range | Stop whole | Fixed | Last | Jog core / rest (G1) | Fails |
|---|---|---:|---:|---:|---:|---|---|---|---:|---:|
| XYZ | L1920 1920×1080 | 280 | 523.5 × 264 | 1902 × 280 | 0 | bad 0/47 | yes | yes | None / None | 0 |
| XYZ | L1600 1600×900 | 280 | 523.5 × 264 | 1582 × 280 | 288 | bad 26/47 | NO | yes | None / None | 26 |
| XYZ | L1280 1280×800 | 280 | 523.5 × 264 | 1262 × 280 | 608 | bad 12/47 | NO | yes | None / None | 12 |
| XYZ | L1000 1000×800 | 280 | 523.5 × 264 | 982 × 280 | 888 | bad 11/47 | NO | yes | None / None | 11 |
| XYZ | P1080 1080×1920 | 252 | 252 × 590.5 | 268 × 1806 | 0 | bad 0/47 | yes | yes | None / None | 0 |
| XYZ | P900 900×1200 | 252 | 252 × 590.5 | 268 × 1050 | 653 | bad 16/47 | NO | yes | None / None | 16 |
| XZ | L1920 1920×1080 | 280 | 272 × 264 | 1902 × 280 | 0 | bad 47/47 | yes | yes | None / None | 47 |
| XZ | L1600 1600×900 | 280 | 272 × 264 | 1582 × 280 | 36 | bad 47/47 | NO | NO | None / None | 48 |
| XZ | L1280 1280×800 | 280 | 272 × 264 | 1262 × 280 | 356 | bad 15/47 | NO | yes | None / None | 15 |
| XZ | L1000 1000×800 | 280 | 272 × 264 | 982 × 280 | 636 | bad 12/47 | NO | yes | None / None | 12 |
| XZ | P1080 1080×1920 | 252 | 252 × 330.5 | 268 × 1806 | 0 | bad 47/47 | yes | yes | None / None | 47 |
| XZ | P900 900×1200 | 252 | 252 × 330.5 | 268 × 1050 | 353 | bad 22/47 | NO | yes | None / None | 22 |
| Z | L1920 1920×1080 | 280 | 272 × 264 | 1902 × 280 | 0 | bad 47/47 | yes | yes | None / None | 47 |
| Z | L1600 1600×900 | 280 | 272 × 264 | 1582 × 280 | 4 | bad 47/47 | NO | yes | None / None | 47 |
| Z | L1280 1280×800 | 280 | 272 × 264 | 1262 × 280 | 324 | bad 16/47 | NO | NO | None / None | 17 |
| Z | L1000 1000×800 | 280 | 272 × 264 | 982 × 280 | 604 | bad 11/47 | NO | yes | None / None | 11 |
| Z | P1080 1080×1920 | 252 | 252 × 330.5 | 268 × 1806 | 0 | bad 47/47 | yes | yes | None / None | 47 |
| Z | P900 900×1200 | 252 | 252 × 330.5 | 268 × 1050 | 313 | bad 24/47 | NO | NO | None / None | 25 |
| XYZAC | L1920 1920×1080 | 280 | 662.5 × 264 | 1902 × 280 | 203 | bad 24/47 | NO | NO | None / None | 25 |
| XYZAC | L1600 1600×900 | 280 | 662.5 × 264 | 1582 × 280 | 523 | bad 20/47 | NO | NO | None / None | 21 |
| XYZAC | L1280 1280×800 | 280 | 662.5 × 264 | 1262 × 280 | 843 | bad 15/47 | NO | yes | None / None | 15 |
| XYZAC | L1000 1000×800 | 280 | 662.5 × 264 | 982 × 280 | 1123 | bad 11/47 | NO | yes | None / None | 11 |
| XYZAC | P1080 1080×1920 | 252 | 252 × 699 | 268 × 1806 | 104 | bad 0/47 | NO | yes | None / None | 0 |
| XYZAC | P900 900×1200 | 252 | 252 × 699 | 268 × 1050 | 860 | bad 12/47 | NO | yes | None / None | 12 |
| TWP | L1920 1920×1080 | 280 | 735.5 × 264 | 1902 × 280 | 364 | bad 29/47 | NO | yes | None / None | 29 |
| TWP | L1600 1600×900 | 280 | 735.5 × 264 | 1582 × 280 | 684 | bad 18/47 | NO | NO | None / None | 19 |
| TWP | L1280 1280×800 | 280 | 735.5 × 264 | 1262 × 280 | 1004 | bad 13/47 | NO | yes | None / None | 13 |
| TWP | L1000 1000×800 | 280 | 735.5 × 264 | 982 × 280 | 1284 | bad 13/47 | NO | yes | None / None | 13 |
| TWP | P1080 1080×1920 | 252 | 252 × 721 | 268 × 1806 | 218 | bad 20/47 | NO | yes | None / None | 20 |
| TWP | P900 900×1200 | 252 | 252 × 721 | 268 × 1050 | 974 | bad 11/47 | NO | yes | None / None | 11 |
| 9 axes | L1920 1920×1080 | 280 | 859.5 × 264 | 1902 × 280 | 518 | bad 31/47 | NO | NO | None / None | 32 |
| 9 axes | L1600 1600×900 | 280 | 859.5 × 264 | 1582 × 280 | 838 | bad 22/47 | NO | yes | None / None | 22 |
| 9 axes | L1280 1280×800 | 280 | 859.5 × 264 | 1262 × 280 | 1158 | bad 17/47 | NO | yes | None / None | 17 |
| 9 axes | L1000 1000×800 | 280 | 859.5 × 264 | 982 × 280 | 1438 | bad 14/47 | NO | yes | None / None | 14 |
| 9 axes | P1080 1080×1920 | 252 | 252 × 758.5 | 268 × 1806 | 305 | bad 26/47 | NO | yes | None / None | 26 |
| 9 axes | P900 900×1200 | 252 | 252 × 758.5 | 268 × 1050 | 1061 | bad 15/47 | NO | yes | None / None | 15 |

## Strip — proto-z100 (proto, 100 %, chromium)

| Axes | Window (CSS px) | Safety w | Jog w × h | Window w × h | Range | Stop whole | Fixed | Last | Jog core / rest (G1) | Fails |
|---|---|---:|---:|---:|---:|---|---|---|---:|---:|
| XYZ | L1920 1920×1080 | 280 | 523.5 × 264 | 1082 × 264 | 0 | 47/47 | yes | yes | 357.5 / 166.0 | 0 |
| XYZ | L1600 1600×900 | 280 | 523.5 × 264 | 762 × 264 | 287 | 47/47 | yes | yes | 357.5 / 166.0 | 0 |
| XYZ | L1280 1280×800 | 280 | 523.5 × 264 | 442 × 264 | 607 | 47/47 | yes | yes | 357.5 / 166.0 | 0 |
| XYZ | L1000 1000×800 | 280 | 523.5 × 264 | 162 × 264 | 887 | 47/47 | yes | NO | 357.5 / 166.0 | 1 |
| XYZ | P1080 1080×1920 | 262 | 262 × 590.5 | 268 × 913 | 0 | 47/47 | yes | yes | 528 / -266 | 0 |
| XYZ | P900 900×1200 | 262 | 262 × 590.5 | 268 × 157 | 670 | 47/47 | yes | yes | 528 / -266 | 0 |
| XZ | L1920 1920×1080 | 280 | 344 × 264 | 1261 × 264 | 0 | 47/47 | yes | yes | 178 / 166 | 0 |
| XZ | L1600 1600×900 | 280 | 344 × 264 | 941 × 264 | 108 | 47/47 | yes | NO | 178 / 166 | 1 |
| XZ | L1280 1280×800 | 280 | 344 × 264 | 621 × 264 | 428 | 47/47 | yes | yes | 178 / 166 | 0 |
| XZ | L1000 1000×800 | 280 | 344 × 264 | 341 × 264 | 708 | 47/47 | yes | NO | 178 / 166 | 1 |
| XZ | P1080 1080×1920 | 262 | 262 × 392.5 | 268 × 1111 | 0 | 47/47 | yes | yes | 333 / -71 | 0 |
| XZ | P900 900×1200 | 262 | 262 × 392.5 | 268 × 355 | 432 | 47/47 | yes | yes | 333 / -71 | 0 |
| Z | L1920 1920×1080 | 280 | 344 × 264 | 1261 × 264 | 0 | 47/47 | yes | yes | 178 / 166 | 0 |
| Z | L1600 1600×900 | 280 | 344 × 264 | 941 × 264 | 76 | 47/47 | yes | NO | 178 / 166 | 1 |
| Z | L1280 1280×800 | 280 | 344 × 264 | 621 × 264 | 396 | 47/47 | yes | yes | 178 / 166 | 0 |
| Z | L1000 1000×800 | 280 | 344 × 264 | 341 × 264 | 676 | 47/47 | yes | yes | 178 / 166 | 0 |
| Z | P1080 1080×1920 | 262 | 262 × 392.5 | 268 × 1111 | 0 | 47/47 | yes | yes | 333 / -71 | 0 |
| Z | P900 900×1200 | 262 | 262 × 392.5 | 268 × 355 | 392 | 47/47 | yes | yes | 333 / -71 | 0 |
| XYZAC | L1920 1920×1080 | 280 | 662.5 × 264 | 943 × 264 | 202 | 47/47 | yes | NO | 357.5 / 305.0 | 1 |
| XYZAC | L1600 1600×900 | 280 | 662.5 × 264 | 623 × 264 | 522 | 47/47 | yes | NO | 357.5 / 305.0 | 1 |
| XYZAC | L1280 1280×800 | 280 | 662.5 × 264 | 303 × 264 | 842 | 47/47 | yes | yes | 357.5 / 305.0 | 0 |
| XYZAC | L1000 1000×800 | 280 | 662.5 × 264 | 23 × 264 | 1122 | 47/47 | yes | NO | 357.5 / 305.0 | 4 |
| XYZAC | P1080 1080×1920 | 262 | 262 × 699 | 268 × 805 | 120 | 47/47 | yes | yes | 333 / -71 | 0 |
| XYZAC | P900 900×1200 | 262 | 262 × 699 | 268 × 49 | 876 | 47/47 | yes | yes | 333 / -71 | 0 |
| TWP | L1920 1920×1080 | 280 | 735.5 × 264 | 870 × 264 | 363 | 47/47 | yes | yes | 357.5 / 378.0 | 0 |
| TWP | L1600 1600×900 | 280 | 735.5 × 264 | 550 × 264 | 683 | 47/47 | yes | NO | 357.5 / 378.0 | 1 |
| TWP | L1280 1280×800 | 280 | 735.5 × 264 | 230 × 264 | 1003 | 47/47 | yes | yes | 357.5 / 378.0 | 0 |
| TWP | L1000 1000×800 | 280 | 735.5 × 264 | 16 × 264 | 1217 | 47/47 | yes | NO | 357.5 / 378.0 | 4 |
| TWP | P1080 1080×1920 | 262 | 262 × 721 | 268 × 783 | 234 | 47/47 | yes | yes | 333 / -71 | 0 |
| TWP | P900 900×1200 | 262 | 262 × 721 | 268 × 27 | 990 | 47/47 | yes | NO | 333 / -71 | 3 |
| 9 axes | L1920 1920×1080 | 280 | 859.5 × 264 | 746 × 264 | 517 | 47/47 | yes | NO | 357.5 / 502.0 | 1 |
| 9 axes | L1600 1600×900 | 280 | 859.5 × 264 | 426 × 264 | 837 | 47/47 | yes | yes | 357.5 / 502.0 | 0 |
| 9 axes | L1280 1280×800 | 280 | 859.5 × 264 | 106 × 264 | 1157 | 47/47 | yes | NO | 357.5 / 502.0 | 1 |
| 9 axes | L1000 1000×800 | 280 | 859.5 × 264 | 16 × 264 | 1247 | 47/47 | yes | NO | 357.5 / 502.0 | 4 |
| 9 axes | P1080 1080×1920 | 262 | 262 × 758.5 | 268 × 745 | 322 | 47/47 | yes | NO | 333 / -71 | 1 |
| 9 axes | P900 900×1200 | 262 | 262 × 758.5 | 268 × 8 | 1059 | 47/47 | yes | NO | 333 / -71 | 4 |

## Strip — proto-z150 (proto, 150 %, chromium)

| Axes | Window (CSS px) | Safety w | Jog w × h | Window w × h | Range | Stop whole | Fixed | Last | Jog core / rest (G1) | Fails |
|---|---|---:|---:|---:|---:|---|---|---|---:|---:|
| XYZ | L1920 1280×720 | 280 | 523.5 × 264 | 442 × 264 | 607 | 47/47 | yes | yes | 357.5 / 166.0 | 0 |
| XYZ | L1280 853×533 | 280 | 523.5 × 264 | 16 × 264 | 1033 | 47/47 | yes | NO | 357.5 / 166.0 | 4 |
| XYZ | L1000 667×533 | 280 | 523.5 × 264 | 16 × 264 | 1033 | 47/47 | yes | NO | 357.5 / 166.0 | 4 |
| XYZ | P1080 720×1280 | 262 | 262 × 590.5 | 268 × 237 | 590 | 47/47 | yes | yes | 528 / -266 | 0 |
| XYZAC | L1920 1280×720 | 280 | 662.5 × 264 | 303 × 264 | 842 | 47/47 | yes | yes | 357.5 / 305.0 | 0 |
| XYZAC | L1280 853×533 | 280 | 662.5 × 264 | 16 × 264 | 1129 | 47/47 | yes | NO | 357.5 / 305.0 | 4 |
| XYZAC | L1000 667×533 | 280 | 662.5 × 264 | 16 × 264 | 1129 | 47/47 | yes | NO | 357.5 / 305.0 | 4 |
| XYZAC | P1080 720×1280 | 262 | 262 × 699 | 268 × 129 | 796 | 47/47 | yes | yes | 333 / -71 | 0 |
| TWP | L1920 1280×720 | 280 | 735.5 × 264 | 230 × 264 | 1003 | 47/47 | yes | yes | 357.5 / 378.0 | 0 |
| TWP | L1280 853×533 | 280 | 735.5 × 264 | 16 × 264 | 1217 | 47/47 | yes | NO | 357.5 / 378.0 | 4 |
| TWP | L1000 667×533 | 280 | 735.5 × 264 | 16 × 264 | 1217 | 47/47 | yes | NO | 357.5 / 378.0 | 4 |
| TWP | P1080 720×1280 | 262 | 262 × 721 | 268 × 107 | 910 | 47/47 | yes | yes | 333 / -71 | 0 |
| 9 axes | L1920 1280×720 | 280 | 859.5 × 264 | 106 × 264 | 1157 | 47/47 | yes | NO | 357.5 / 502.0 | 1 |
| 9 axes | L1280 853×533 | 280 | 859.5 × 264 | 16 × 264 | 1247 | 47/47 | yes | NO | 357.5 / 502.0 | 4 |
| 9 axes | L1000 667×533 | 280 | 859.5 × 264 | 16 × 264 | 1247 | 47/47 | yes | NO | 357.5 / 502.0 | 4 |
| 9 axes | P1080 720×1280 | 262 | 262 × 758.5 | 268 × 69 | 998 | 47/47 | yes | yes | 333 / -71 | 0 |

## Strip — ff-proto-z100 (proto, 100 %, firefox)

| Axes | Window (CSS px) | Safety w | Jog w × h | Window w × h | Range | Stop whole | Fixed | Last | Jog core / rest (G1) | Fails |
|---|---|---:|---:|---:|---:|---|---|---|---:|---:|
| XYZ | L1280 1280×800 | 280 | 521.8 × 264 | 443 × 264 | 580 | 47/47 | yes | yes | 355.5 / 166.3 | 0 |
| XYZ | L1000 1000×800 | 280 | 521.8 × 264 | 163 × 264 | 860 | 47/47 | yes | NO | 355.5 / 166.3 | 1 |
| XYZ | P900 900×1200 | 262 | 262 × 577.5 | 272 × 182 | 551 | 47/47 | yes | yes | 536 / -274 | 0 |
| XZ | L1280 1280×800 | 280 | 340.2 × 264 | 625 × 264 | 398 | 47/47 | yes | yes | 173.9 / 166.3 | 0 |
| XZ | L1000 1000×800 | 280 | 340.2 × 264 | 345 × 264 | 678 | 47/47 | yes | NO | 173.9 / 166.3 | 1 |
| XZ | P900 900×1200 | 262 | 262 × 375.5 | 272 × 384 | 311 | 47/47 | yes | yes | 338 / -76 | 0 |
| TWP | L1280 1280×800 | 280 | 726.3 × 264 | 239 × 264 | 970 | 47/47 | yes | yes | 355.5 / 370.8 | 0 |
| TWP | P900 900×1200 | 262 | 262 × 699 | 272 × 61 | 856 | 47/47 | yes | yes | 338 / -76 | 0 |
| 9 axes | L1280 1280×800 | 280 | 853.3 × 264 | 112 × 264 | 1124 | 47/47 | yes | NO | 355.5 / 497.8 | 1 |
| 9 axes | P900 900×1200 | 262 | 262 × 744.5 | 272 × 15 | 946 | 47/47 | yes | NO | 338 / -76 | 4 |

## Strip — ff-proto-z150 (proto, 150 %, firefox)

| Axes | Window (CSS px) | Safety w | Jog w × h | Window w × h | Range | Stop whole | Fixed | Last | Jog core / rest (G1) | Fails |
|---|---|---:|---:|---:|---:|---|---|---|---:|---:|
| XYZ | L1280 853×533 | 280 | 521.8 × 264 | 16 × 264 | 1007 | 47/47 | yes | NO | 355.5 / 166.3 | 4 |
| XYZ | P1080 720×1280 | 262 | 262 × 577.5 | 272 × 262 | 471 | 47/47 | yes | yes | 536 / -274 | 0 |
| TWP | P1080 720×1280 | 262 | 262 × 699 | 272 × 141 | 776 | 47/47 | yes | yes | 338 / -76 | 0 |

## Banner — today-z100 (today, 100 %, chromium)

| Window | Abort rect (x, y, w, h) | present | live | whole | one rect | Ack whole | count whole | actions max w (state) | text min w | fails |
|---|---|---|---|---|---|---|---|---|---:|---:|
| L1920 1920×1080 | [1820, 56, 78, 36] | 3/9 | 3/9 | 3/9 | yes | 1/1 | 7/7 | 394 (all-actions) | 1470 | 0 |
| L1600 1600×900 | [1500, 56, 78, 36] | 3/9 | 3/9 | 3/9 | yes | 1/1 | 7/7 | 394 (all-actions) | 1150 | 0 |
| L1280 1280×800 | [1180, 56, 78, 36] | 3/9 | 3/9 | 3/9 | yes | 1/1 | 7/7 | 394 (all-actions) | 830 | 0 |
| L1000 1000×800 | [900, 92, 78, 36] | 3/9 | 3/9 | 3/9 | yes | 1/1 | 7/7 | 394 (all-actions) | 550 | 0 |
| P1080 1080×1920 | [980, 56, 78, 36] | 3/9 | 3/9 | 3/9 | yes | 1/1 | 7/7 | 394 (all-actions) | 630 | 0 |
| P900 900×1200 | [800, 92, 78, 36] | 3/9 | 3/9 | 3/9 | yes | 1/1 | 7/7 | 394 (all-actions) | 450 | 0 |

States: rest, running, message-running, paused, disarmed, trip, all-actions, no-first-status, disconnected.

Today's Abort per state (L1920): rest=no, running=yes, message-running=yes, paused=yes, disarmed=no, trip=no, all-actions=no, no-first-status=no, disconnected=no

## Banner — proto-z100 (proto, 100 %, chromium)

| Window | Abort rect (x, y, w, h) | present | live | whole | one rect | Ack whole | count whole | actions max w (state) | text min w | fails |
|---|---|---|---|---|---|---|---|---|---:|---:|
| L1920 1920×1080 | [1820, 56, 78, 44] | 9/9 | 9/9 | 9/9 | yes | 1/1 | 7/7 | 394 (all-actions) | 1356 | 0 |
| L1600 1600×900 | [1500, 56, 78, 44] | 9/9 | 9/9 | 9/9 | yes | 1/1 | 7/7 | 394 (all-actions) | 1036 | 0 |
| L1280 1280×800 | [1180, 56, 78, 44] | 9/9 | 9/9 | 9/9 | yes | 1/1 | 7/7 | 394 (all-actions) | 716 | 0 |
| L1000 1000×800 | [900, 92, 78, 44] | 9/9 | 9/9 | 9/9 | yes | 1/1 | 7/7 | 394 (all-actions) | 436 | 0 |
| P1080 1080×1920 | [980, 56, 78, 44] | 9/9 | 9/9 | 9/9 | yes | 1/1 | 7/7 | 394 (all-actions) | 516 | 0 |
| P900 900×1200 | [800, 92, 78, 44] | 9/9 | 9/9 | 9/9 | yes | 1/1 | 7/7 | 394 (all-actions) | 336 | 0 |

States: rest, running, message-running, paused, disarmed, trip, all-actions, no-first-status, disconnected.

## Banner — proto-z150 (proto, 150 %, chromium)

| Window | Abort rect (x, y, w, h) | present | live | whole | one rect | Ack whole | count whole | actions max w (state) | text min w | fails |
|---|---|---|---|---|---|---|---|---|---:|---:|
| L1920 1280×720 | [1180, 56, 78, 44] | 9/9 | 9/9 | 9/9 | yes | 1/1 | 7/7 | 394 (all-actions) | 716 | 0 |
| L1280 853×533 | [753, 92, 78, 44] | 9/9 | 9/9 | 9/9 | yes | 1/1 | 7/7 | 394 (all-actions) | 289 | 0 |
| L1000 667×533 | [567, 92, 78, 44] | 9/9 | 9/9 | 9/9 | yes | 1/1 | 7/7 | 394 (all-actions) | 103 | 0 |
| P1080 720×1280 | [620, 92, 78, 44] | 9/9 | 9/9 | 9/9 | yes | 1/1 | 7/7 | 394 (all-actions) | 156 | 0 |

States: rest, running, message-running, paused, disarmed, trip, all-actions, no-first-status, disconnected.

## Banner — ff-proto-z100 (proto, 100 %, firefox)

| Window | Abort rect (x, y, w, h) | present | live | whole | one rect | Ack whole | count whole | actions max w (state) | text min w | fails |
|---|---|---|---|---|---|---|---|---|---:|---:|
| L1280 1280×800 | [1181.9, 56, 76.1, 32] | 9/9 | 9/9 | 9/9 | yes | 1/1 | 7/7 | 378.3 (all-actions) | 736.6 | 0 |
| L1000 1000×800 | [901.9, 92, 76.1, 32] | 9/9 | 9/9 | 9/9 | yes | 1/1 | 7/7 | 378.3 (all-actions) | 456.6 | 0 |
| P900 900×1200 | [801.9, 92, 76.1, 32] | 9/9 | 9/9 | 9/9 | yes | 1/1 | 7/7 | 378.3 (all-actions) | 356.6 | 0 |

States: rest, running, message-running, paused, disarmed, trip, all-actions, no-first-status, disconnected.

## Banner — ff-proto-z150 (proto, 150 %, firefox)

| Window | Abort rect (x, y, w, h) | present | live | whole | one rect | Ack whole | count whole | actions max w (state) | text min w | fails |
|---|---|---|---|---|---|---|---|---|---:|---:|
| L1280 853×533 | [754.9, 92, 76.1, 32] | 9/9 | 9/9 | 9/9 | yes | 1/1 | 7/7 | 378.3 (all-actions) | 309.6 | 0 |
| P1080 720×1280 | [621.9, 92, 76.1, 32] | 9/9 | 9/9 | 9/9 | yes | 1/1 | 7/7 | 378.3 (all-actions) | 176.6 | 0 |

States: rest, running, message-running, paused, disarmed, trip, all-actions, no-first-status, disconnected.

## Jog width per machine state — today-z100

| Axes | Window | States | Jog box (w × h) | one box |
|---|---|---|---|---|
| XYZ | L1280 | homed, unhomed, joint-jog | 523.5 × 264 | yes |
| XYZ | P1080 | homed, unhomed, joint-jog | 252 × 590.5 | yes |
| XZ | L1280 | homed, unhomed | 272 × 264 | yes |
| XZ | P1080 | homed, unhomed | 252 × 330.5 | yes |
| XYZAC | L1280 | homed, unhomed, tcp, joint-jog | 662.5 × 264 | yes |
| XYZAC | P1080 | homed, unhomed, tcp, joint-jog | 252 × 699 | yes |
| TWP | L1280 | homed, unhomed, tcp, plane, plane-stale, joint-jog | 735.5 × 264 | yes |
| TWP | P1080 | homed, unhomed, tcp, plane, plane-stale, joint-jog | 252 × 721 | yes |
| 9 axes | L1280 | homed, unhomed, joint-jog | 859.5 × 264 | yes |
| 9 axes | P1080 | homed, unhomed, joint-jog | 252 × 758.5 | yes |

## Jog width per machine state — proto-z100

| Axes | Window | States | Jog box (w × h) | one box |
|---|---|---|---|---|
| XYZ | L1280 | homed, unhomed, joint-jog | 523.5 × 264 | yes |
| XYZ | P1080 | homed, unhomed, joint-jog | 262 × 590.5 | yes |
| XZ | L1280 | homed, unhomed | 344 × 264 | yes |
| XZ | P1080 | homed, unhomed | 262 × 392.5 | yes |
| XYZAC | L1280 | homed, unhomed, tcp, joint-jog | 662.5 × 264 | yes |
| XYZAC | P1080 | homed, unhomed, tcp, joint-jog | 262 × 699 | yes |
| TWP | L1280 | homed, unhomed, tcp, plane, plane-stale, joint-jog | 735.5 × 264 | yes |
| TWP | P1080 | homed, unhomed, tcp, plane, plane-stale, joint-jog | 262 × 721 | yes |
| 9 axes | L1280 | homed, unhomed, joint-jog | 859.5 × 264 | yes |
| 9 axes | P1080 | homed, unhomed, joint-jog | 262 × 758.5 | yes |

## Helpers — proto-z100 (100 %, chromium)

PARTIAL (31 of 48): this step was stopped to free the lock for a Codex review; the complete set is proto-z100b.

| Helper | Rule | Axes | Window | Jog w | Helper w | Window w | Helper whole | Stop whole | fails |
|---|---|---|---|---:|---:|---:|---|---|---:|
| gcode-keypad | H1 | XYZ | L1920 | 523.5 | 475 | 1082.0 | yes | yes | 0 |
| gcode-keypad | H1 | XYZ | L1280 | 523.5 | 475 | 442.0 | NO | yes | 1 |
| gcode-keypad | H1 | XYZ | L1000 | 523.5 | 475 | 162.0 | NO | yes | 1 |
| gcode-keypad | H1 | XYZ | P1080 | 262 | 252 | 268 | yes | yes | 0 |
| gcode-keypad | H1 | TWP | L1920 | 735.5 | 475 | 870.0 | yes | yes | 0 |
| gcode-keypad | H1 | TWP | L1280 | 735.5 | 475 | 230.0 | NO | yes | 1 |
| gcode-keypad | H1 | TWP | L1000 | 735.5 | 475 | 16.0 | NO | yes | 1 |
| gcode-keypad | H1 | TWP | P1080 | 262 | 252 | 268 | yes | yes | 0 |
| gcode-keypad | H2 | XYZ | L1920 | 69 | 475 | 1536 | yes | yes | 0 |
| gcode-keypad | H2 | XYZ | L1280 | 69 | 475 | 896 | yes | yes | 0 |
| gcode-keypad | H2 | XYZ | L1000 | 69 | 475 | 616 | yes | yes | 0 |
| gcode-keypad | H2 | XYZ | P1080 | 262 | 252 | 268 | yes | yes | 0 |
| gcode-keypad | H2 | TWP | L1920 | 69 | 475 | 1536 | yes | yes | 0 |
| gcode-keypad | H2 | TWP | L1280 | 69 | 475 | 896 | yes | yes | 0 |
| gcode-keypad | H2 | TWP | L1000 | 69 | 475 | 616 | yes | yes | 0 |
| gcode-keypad | H2 | TWP | P1080 | 262 | 252 | 268 | yes | yes | 0 |
| keypad-setup | H1 | XYZ | L1920 | 523.5 | 319 | 1082.0 | yes | yes | 0 |
| keypad-setup | H1 | XYZ | L1280 | 523.5 | 319 | 442.0 | NO | yes | 1 |
| keypad-setup | H1 | XYZ | L1000 | 523.5 | 319 | 162.0 | NO | yes | 1 |
| keypad-setup | H1 | XYZ | P1080 | 262 | 252 | 268 | yes | yes | 0 |
| keypad-setup | H1 | TWP | L1920 | 735.5 | 319 | 870.0 | NO | yes | 1 |
| keypad-setup | H1 | TWP | L1280 | 735.5 | 319 | 230.0 | NO | yes | 1 |
| keypad-setup | H1 | TWP | P1080 | 262 | 252 | 268 | yes | yes | 0 |
| keypad-setup | H1 | 9 axes | L1920 | 859.5 | 319 | 746.0 | NO | yes | 1 |
| keypad-setup | H2 | XYZ | L1920 | 69 | 319 | 1536 | yes | yes | 0 |
| keypad-setup | H2 | XYZ | L1280 | 69 | 319 | 896 | yes | yes | 0 |
| keypad-setup | H2 | XYZ | L1000 | 69 | 319 | 616 | NO | yes | 1 |
| keypad-setup | H2 | XYZ | P1080 | 262 | 252 | 268 | yes | yes | 0 |
| keypad-setup | H2 | TWP | L1920 | 69 | 319 | 1536 | yes | yes | 0 |
| keypad-setup | H2 | TWP | L1280 | 69 | 319 | 896 | yes | yes | 0 |
| keypad-setup | H2 | TWP | P1080 | 262 | 252 | 268 | yes | yes | 0 |

## Helpers — proto-z100b (100 %, chromium)

| Helper | Rule | Axes | Window | Jog w | Helper w | Window w | Helper whole | Stop whole | fails |
|---|---|---|---|---:|---:|---:|---|---|---:|
| gcode-keypad | H1 | XYZ | L1920 | 523.5 | 475 | 1082.0 | yes | yes | 0 |
| gcode-keypad | H1 | XYZ | L1280 | 523.5 | 475 | 442.0 | NO | yes | 1 |
| gcode-keypad | H1 | XYZ | L1000 | 523.5 | 475 | 162.0 | NO | yes | 1 |
| gcode-keypad | H1 | XYZ | P1080 | 262 | 252 | 268 | yes | yes | 0 |
| gcode-keypad | H1 | TWP | L1920 | 735.5 | 475 | 870.0 | yes | yes | 0 |
| gcode-keypad | H1 | TWP | L1280 | 735.5 | 475 | 230.0 | NO | yes | 1 |
| gcode-keypad | H1 | TWP | L1000 | 735.5 | 475 | 16.0 | NO | yes | 1 |
| gcode-keypad | H1 | TWP | P1080 | 262 | 252 | 268 | yes | yes | 0 |
| gcode-keypad | H1 | 9 axes | L1920 | 859.5 | 475 | 746.0 | yes | yes | 0 |
| gcode-keypad | H1 | 9 axes | L1280 | 859.5 | 475 | 106.0 | NO | yes | 1 |
| gcode-keypad | H1 | 9 axes | L1000 | 859.5 | 475 | 16.0 | NO | yes | 1 |
| gcode-keypad | H1 | 9 axes | P1080 | 262 | 252 | 268 | yes | yes | 0 |
| gcode-keypad | H2 | XYZ | L1920 | 69 | 475 | 1536 | yes | yes | 0 |
| gcode-keypad | H2 | XYZ | L1280 | 69 | 475 | 896 | yes | yes | 0 |
| gcode-keypad | H2 | XYZ | L1000 | 69 | 475 | 616 | yes | yes | 0 |
| gcode-keypad | H2 | XYZ | P1080 | 262 | 252 | 268 | yes | yes | 0 |
| gcode-keypad | H2 | TWP | L1920 | 69 | 475 | 1536 | yes | yes | 0 |
| gcode-keypad | H2 | TWP | L1280 | 69 | 475 | 896 | yes | yes | 0 |
| gcode-keypad | H2 | TWP | L1000 | 69 | 475 | 616 | yes | yes | 0 |
| gcode-keypad | H2 | TWP | P1080 | 262 | 252 | 268 | yes | yes | 0 |
| gcode-keypad | H2 | 9 axes | L1920 | 69 | 475 | 1536 | yes | yes | 0 |
| gcode-keypad | H2 | 9 axes | L1280 | 69 | 475 | 896 | yes | yes | 0 |
| gcode-keypad | H2 | 9 axes | L1000 | 69 | 475 | 616 | yes | yes | 0 |
| gcode-keypad | H2 | 9 axes | P1080 | 262 | 252 | 268 | yes | yes | 0 |
| keypad-setup | H1 | XYZ | L1920 | 523.5 | 319 | 1082.0 | yes | yes | 0 |
| keypad-setup | H1 | XYZ | L1280 | 523.5 | 319 | 442.0 | NO | yes | 1 |
| keypad-setup | H1 | XYZ | L1000 | 523.5 | 319 | 162.0 | NO | yes | 1 |
| keypad-setup | H1 | XYZ | P1080 | 262 | 252 | 268 | yes | yes | 0 |
| keypad-setup | H1 | TWP | L1920 | 735.5 | 319 | 870.0 | NO | yes | 1 |
| keypad-setup | H1 | TWP | L1280 | 735.5 | 319 | 230.0 | NO | yes | 1 |
| keypad-setup | H1 | TWP | P1080 | 262 | 252 | 268 | yes | yes | 0 |
| keypad-setup | H1 | 9 axes | L1920 | 859.5 | 319 | 746.0 | NO | yes | 1 |
| keypad-setup | H1 | 9 axes | L1280 | 859.5 | 319 | 106.0 | NO | yes | 1 |
| keypad-setup | H1 | 9 axes | P1080 | 262 | 252 | 268 | yes | yes | 0 |
| keypad-setup | H2 | XYZ | L1920 | 69 | 319 | 1536 | yes | yes | 0 |
| keypad-setup | H2 | XYZ | L1280 | 69 | 319 | 896 | yes | yes | 0 |
| keypad-setup | H2 | XYZ | L1000 | 69 | 319 | 616 | NO | yes | 1 |
| keypad-setup | H2 | XYZ | P1080 | 262 | 252 | 268 | yes | yes | 0 |
| keypad-setup | H2 | TWP | L1920 | 69 | 319 | 1536 | yes | yes | 0 |
| keypad-setup | H2 | TWP | L1280 | 69 | 319 | 896 | yes | yes | 0 |
| keypad-setup | H2 | TWP | P1080 | 262 | 252 | 268 | yes | yes | 0 |
| keypad-setup | H2 | 9 axes | L1920 | 69 | 319 | 1536 | yes | yes | 0 |
| keypad-setup | H2 | 9 axes | L1280 | 69 | 319 | 896 | NO | yes | 1 |
| keypad-setup | H2 | 9 axes | P1080 | 262 | 252 | 268 | yes | yes | 0 |

## Dialog Tab scope — today-z100: reached ['dialog', 'safety:ArmDisarm', 'safety:E-StopReset', 'safety:Power onPowe', 'safety:']

## Held press — proto-z100: Abort held through paused, trip, all-actions, rest, running; rect constant: yes; jog Stop held through 4 window scrolls: constant

## Dialog Tab scope — proto-z100: reached ['dialog', 'banner:Abort', 'safety:ArmDisarm', 'safety:E-StopReset', 'safety:Power onPowe', 'safety:', 'jog:Stop']

## Held press — ff-proto-z100: Abort held through paused, trip, all-actions, rest, running; rect constant: yes; jog Stop held through 4 window scrolls: constant

## Dialog Tab scope — ff-proto-z100: reached ['dialog', 'banner:Abort', 'safety:ArmDisarm', 'safety:E-StopReset', 'safety:Power onPowe', 'safety:', 'jog:Stop']

## XYZ 1920: today vs prototype section rects

| Section | today | prototype |
|---|---|---|
| safety | [9, 789, 280, 264] | [9, 789, 280, 264] |
| jog | [297, 789, 523.5, 264] | [297, 789, 523.5, 264] |
| setup | [828.5, 789, 369, 264] | [837.5, 789, 360, 264] |
| overrides | [1205.5, 789, 192, 264] | [1205.5, 789, 192, 264] |
| spindle | [1405.5, 789, 233, 264] | [1405.5, 789, 233, 264] |
| tool | [1646.5, 789, 256.5, 264] | [1646.5, 789, 256.5, 264] |
| window range | 0 | 0 |

## Narrow form G1 — proto-z100b (100 %, chromium)

| Axes | Window | Head Jog w × h | Window w × h | Jog in window w × h | Range | Stop whole | Fixed | Last | fails |
|---|---|---:|---:|---:|---:|---|---|---|---:|
| XYZ | L1600 | 69 × 264 | 1216 × 264 | 514.5 × 264 | 365 | 31/31 | yes | yes | 0 |
| XYZ | L1280 | 69 × 264 | 896 × 264 | 514.5 × 264 | 685 | 31/31 | yes | NO | 1 |
| XYZ | L1000 | 69 × 264 | 616 × 264 | 514.5 × 264 | 965 | 31/31 | yes | yes | 0 |
| XYZ | P1080 | 262 × 87.5 | 268 × 1416 | 252 × 581.5 | 9 | 31/31 | yes | yes | 0 |
| XYZ | P900 | 262 × 87.5 | 268 × 660 | 252 × 581.5 | 765 | 31/31 | yes | yes | 0 |
| XZ | L1600 | 69 × 264 | 1216 × 264 | 335 × 264 | 185 | 31/31 | yes | NO | 1 |
| XZ | L1280 | 69 × 264 | 896 × 264 | 335 × 264 | 505 | 31/31 | yes | NO | 1 |
| XZ | L1000 | 69 × 264 | 616 × 264 | 335 × 264 | 785 | 31/31 | yes | yes | 0 |
| XZ | P1080 | 262 × 87.5 | 268 × 1416 | 252 × 383.5 | 0 | 31/31 | yes | yes | 0 |
| XZ | P900 | 262 × 87.5 | 268 × 660 | 252 × 383.5 | 527 | 31/31 | yes | yes | 0 |
| Z | L1600 | 69 × 264 | 1216 × 264 | 335 × 264 | 153 | 31/31 | yes | NO | 1 |
| Z | L1280 | 69 × 264 | 896 × 264 | 335 × 264 | 473 | 31/31 | yes | yes | 0 |
| Z | L1000 | 69 × 264 | 616 × 264 | 335 × 264 | 753 | 31/31 | yes | yes | 0 |
| Z | P1080 | 262 × 87.5 | 268 × 1416 | 252 × 383.5 | 0 | 31/31 | yes | yes | 0 |
| Z | P900 | 262 × 87.5 | 268 × 660 | 252 × 383.5 | 487 | 31/31 | yes | yes | 0 |
| XYZAC | L1600 | 69 × 264 | 1216 × 264 | 653.5 × 264 | 600 | 31/31 | yes | yes | 0 |
| XYZAC | L1280 | 69 × 264 | 896 × 264 | 653.5 × 264 | 920 | 31/31 | yes | yes | 0 |
| XYZAC | L1000 | 69 × 264 | 616 × 264 | 653.5 × 264 | 1200 | 31/31 | yes | NO | 1 |
| XYZAC | P1080 | 262 × 87.5 | 268 × 1416 | 252 × 690 | 216 | 31/31 | yes | yes | 0 |
| XYZAC | P900 | 262 × 87.5 | 268 × 660 | 252 × 690 | 972 | 31/31 | yes | yes | 0 |
| TWP | L1600 | 69 × 264 | 1216 × 264 | 726.5 × 264 | 761 | 31/31 | yes | yes | 0 |
| TWP | L1280 | 69 × 264 | 896 × 264 | 726.5 × 264 | 1081 | 31/31 | yes | yes | 0 |
| TWP | L1000 | 69 × 264 | 616 × 264 | 726.5 × 264 | 1361 | 31/31 | yes | yes | 0 |
| TWP | P1080 | 262 × 87.5 | 268 × 1416 | 252 × 712 | 330 | 31/31 | yes | NO | 1 |
| TWP | P900 | 262 × 87.5 | 268 × 660 | 252 × 712 | 1086 | 31/31 | yes | yes | 0 |
| 9 axes | L1600 | 69 × 264 | 1216 × 264 | 850.5 × 264 | 915 | 31/31 | yes | yes | 0 |
| 9 axes | L1280 | 69 × 264 | 896 × 264 | 850.5 × 264 | 1235 | 31/31 | yes | yes | 0 |
| 9 axes | L1000 | 69 × 264 | 616 × 264 | 850.5 × 264 | 1515 | 31/31 | yes | yes | 0 |
| 9 axes | P1080 | 262 × 87.5 | 268 × 1416 | 252 × 749.5 | 417 | 31/31 | yes | yes | 0 |
| 9 axes | P900 | 262 × 87.5 | 268 × 660 | 252 × 749.5 | 1173 | 31/31 | yes | yes | 0 |

## Narrow form G1 — proto-z150 (150 %, chromium)

| Axes | Window | Head Jog w × h | Window w × h | Jog in window w × h | Range | Stop whole | Fixed | Last | fails |
|---|---|---:|---:|---:|---:|---|---|---|---:|
| XYZ | L1280 | 69 × 264 | 469 × 264 | 514.5 × 264 | 1112 | 31/31 | yes | yes | 0 |
| XYZ | L1000 | 69 × 264 | 283 × 264 | 514.5 × 264 | 1298 | 31/31 | yes | yes | 0 |
| XYZ | P1080 | 262 × 87.5 | 268 × 740 | 252 × 581.5 | 685 | 31/31 | yes | yes | 0 |
| XYZAC | L1280 | 69 × 264 | 469 × 264 | 653.5 × 264 | 1347 | 31/31 | yes | yes | 0 |
| XYZAC | L1000 | 69 × 264 | 283 × 264 | 653.5 × 264 | 1533 | 31/31 | yes | yes | 0 |
| XYZAC | P1080 | 262 × 87.5 | 268 × 740 | 252 × 690 | 892 | 31/31 | yes | yes | 0 |
| TWP | L1280 | 69 × 264 | 469 × 264 | 726.5 × 264 | 1508 | 31/31 | yes | yes | 0 |
| TWP | L1000 | 69 × 264 | 283 × 264 | 726.5 × 264 | 1694 | 31/31 | yes | yes | 0 |
| TWP | P1080 | 262 × 87.5 | 268 × 740 | 252 × 712 | 1006 | 31/31 | yes | yes | 0 |
| 9 axes | L1280 | 69 × 264 | 469 × 264 | 850.5 × 264 | 1662 | 31/31 | yes | yes | 0 |
| 9 axes | L1000 | 69 × 264 | 283 × 264 | 850.5 × 264 | 1848 | 31/31 | yes | yes | 0 |
| 9 axes | P1080 | 262 × 87.5 | 268 × 740 | 252 × 749.5 | 1093 | 31/31 | yes | yes | 0 |

## Narrow form G1 — ff-proto-z100 (100 %, firefox)

| Axes | Window | Head Jog w × h | Window w × h | Jog in window w × h | Range | Stop whole | Fixed | Last | fails |
|---|---|---:|---:|---:|---:|---|---|---|---:|
| XYZ | L1280 | 66.9 × 264 | 898 × 264 | 512.8 × 264 | 655 | 31/31 | yes | yes | 0 |
| XYZ | L1000 | 66.9 × 264 | 618 × 264 | 512.8 × 264 | 935 | 31/31 | yes | yes | 0 |
| XYZ | P900 | 262 × 87.5 | 272 × 672 | 256 × 568.5 | 646 | 31/31 | yes | yes | 0 |
| XZ | L1280 | 66.9 × 264 | 898 × 264 | 331.2 × 264 | 473 | 31/31 | yes | yes | 0 |
| XZ | L1000 | 66.9 × 264 | 618 × 264 | 331.2 × 264 | 753 | 31/31 | yes | yes | 0 |
| XZ | P900 | 262 × 87.5 | 272 × 672 | 256 × 366.5 | 406 | 31/31 | yes | yes | 0 |
| TWP | L1280 | 66.9 × 264 | 898 × 264 | 717.3 × 264 | 1046 | 31/31 | yes | yes | 0 |
| TWP | L1000 | 66.9 × 264 | 618 × 264 | 717.3 × 264 | 1326 | 31/31 | yes | yes | 0 |
| TWP | P900 | 262 × 87.5 | 272 × 672 | 256 × 690 | 952 | 31/31 | yes | NO | 1 |
| 9 axes | L1280 | 66.9 × 264 | 898 × 264 | 844.3 × 264 | 1200 | 31/31 | yes | yes | 0 |
| 9 axes | L1000 | 66.9 × 264 | 618 × 264 | 844.3 × 264 | 1480 | 31/31 | yes | yes | 0 |
| 9 axes | P900 | 262 × 87.5 | 272 × 672 | 256 × 735.5 | 1041 | 31/31 | yes | yes | 0 |

## Narrow form G1 — ff-proto-z150 (150 %, firefox)

| Axes | Window | Head Jog w × h | Window w × h | Jog in window w × h | Range | Stop whole | Fixed | Last | fails |
|---|---|---:|---:|---:|---:|---|---|---|---:|
| XYZ | L1280 | 66.9 × 264 | 471 × 264 | 512.8 × 264 | 1082 | 31/31 | yes | yes | 0 |
| XYZ | P1080 | 262 × 87.5 | 272 × 752 | 256 × 568.5 | 566 | 31/31 | yes | yes | 0 |
| TWP | L1280 | 66.9 × 264 | 471 × 264 | 717.3 × 264 | 1473 | 31/31 | yes | yes | 0 |
| TWP | P1080 | 262 × 87.5 | 272 × 752 | 256 × 690 | 872 | 31/31 | yes | yes | 0 |
