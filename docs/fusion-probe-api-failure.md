# Fusion Probe WCS selection getter failure

Observed on 2026-09-12 in Fusion 2705.1.15 on macOS. This is an audit-workflow
failure, not a LinuxCNC failure or a native probe-contour reference.

After restarting Fusion, the isolated, unsaved `LCNC Tool Geometry Audit`
document was recreated with the existing 20 × 20 × 5 mm reference block and
a valid generated facing operation. Separate normal MCP scripts successfully:

1. Created a `probe` operation input on the milling setup.
2. Assigned the existing Autodesk sample probe through `Tool.createFromJson`.
3. Enumerated parameter **names only**.

The input was retained between calls in a Python module. A subsequent read-only
script read `probe_mode.expression`, then attempted to inspect
`input.parameters.itemByName('probe_selection').value.objectType`.
The call timed out after 300 seconds. No probe operation was added and no probe
toolpath or contour was exported.

A one-second native stack sample recorded the main thread at:

```text
_wrap_CAMParameter__get_value
CAMParameter::value_raw
CAMParameter::createValue
ParameterTable::getCadObject
CadObjectFactoryTemplated<CadProbe>::make
CadProbe::CadProbe
CadProbe::getDraggedPointCadObject
ParameterTable::getCadObjectAs<CadPointOnSurface>
ParameterTable::getParameterNoThrow
_sigtramp
libcer.dylib
read
```

This localizes the native failure to creation of the probing selection value,
before `objectType` can be returned. It does not establish whether retaining
the input, the read-only context, or another native precondition contributes.
The broader parameter-value inspection from the earlier crash must not be
repeated either.

The Fusion process still listened on loopback port 27182 and promptly returned
HTTP 405 to GET `/mcp` while its main thread was in the signal/crash-reporting
path. An open port or an HTTP response therefore does not establish that Fusion
can service model queries. Recovery must be verified with a completed Fusion
MCP read, not just a socket check.

Keep the probe outside native-fidelity assertions until an independent reference
is available. Continue other tool families after Fusion has recovered. Do not
automatically run a reproducer, discard unsaved documents, or modify user tool
libraries to work around this failure. Raw process diagnostics remain local;
they are not committed or sent to Autodesk.
