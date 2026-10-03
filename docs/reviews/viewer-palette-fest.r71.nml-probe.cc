// Private process-local NML buffer, NOT emcCommand. No LinuxCNC instance.
#include <cmd_msg.hh>
#include <iostream>
int format(NMLTYPE, void*, CMS*) { return 1; }
int main(int argc, char** argv) {
  if (argc != 2) return 2;
  RCS_CMD_CHANNEL a(format, "r71Only", "r71A", argv[1]);
  RCS_CMD_CHANNEL b(format, "r71Only", "r71B", argv[1]);
  if (!a.valid() || !b.valid()) return 3;
  RCS_CMD_MSG first(90071, sizeof(RCS_CMD_MSG));
  RCS_CMD_MSG second(90071, sizeof(RCS_CMD_MSG));
  RCS_CMD_MSG third(90071, sizeof(RCS_CMD_MSG));
  first.serial_number = 100;
  second.serial_number = 100;
  third.serial_number = 100;
  int x=a.write(&first), y=b.write(&second), z=a.write(&third);
  std::cout << "{\"write_rc\":[" << x << ',' << y << ',' << z
            << "],\"supplied_serials\":[100,100,100],\"assigned_A_B_A\":["
            << first.serial_number << ',' << second.serial_number << ',' << third.serial_number << "]}\n";
  return x || y || z || !(first.serial_number < second.serial_number && second.serial_number < third.serial_number);
}
