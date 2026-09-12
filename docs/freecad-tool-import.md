# FreeCAD tool libraries

The Tools panel imports FreeCAD CAM libraries alongside Fusion 360 libraries.
The gateway does not need FreeCAD installed. Both the tool-table preview and the
machine viewer use the same saved geometry. Imported tools have no holder.

## Standard shapes: import a ZIP

1. Put **one `.fctl` library and all its referenced `.fctb` tool bits** in a ZIP.
   FreeCAD normally keeps these in sibling `Library` and `Bit` directories; the
   ZIP may retain that structure. Omit the `Shape` directory.
2. In LCNC Suite, open **Tools → Import** and select the ZIP.
3. Review the tool numbers, descriptions and conflicts. **Update existing tool
   metadata** preserves the current table, including measured offsets, pockets
   and compensation diameters. Tools with conflicting identities or diameters
   are skipped.
4. Use **Replace entire tool table** only to deliberately create a new table.
   FreeCAD imports initialize Z to **zero**; measure the tools before use.

Supported source schemas: `.fctl` version 1 and `.fctb` version 2. The tool number
comes from the library's `nr`; a CAM job's ToolController can assign a different
number. Compare the imported numbers with the posted program. A standalone
`.fctb` is also accepted and explicitly assigned **T1**. A `.fctl` alone cannot
supply its referenced bit files. YAML assets are not supported by this adapter.

These 14 standard shapes follow the FreeCAD 1.1 CAM templates: end mill, reamer,
ball end, bullnose, drill, tap, chamfer, V-bit, dovetail, radius mill, slitting saw,
probe, tapered ballnose and thread mill. Dimensions use literal unit strings
(e.g. `6 mm`, `0.25 in`, `90 deg`); unitless lengths are mm and unitless angles
are degrees. Expressions such as `1/4 in` must first be evaluated in FreeCAD.
Legacy bullnose `TorusRadius` and `FlatRadius` are migrated.

A filename cannot prove that a local shape template still has its original
geometry. The direct import therefore identifies its use of **standard
templates** in the preview. Use a native export below for customized templates,
other FreeCAD versions whose templates differ, or custom shapes. ZIPs containing
`.FCStd` models are rejected with that instruction rather than approximated.
Missing or ambiguous tool-bit references are errors; the gateway never opens
paths from the archive on the server and never extracts or executes CAD files.

## Native geometry: export from FreeCAD

Use the repository's `scripts/freecad/export_library.py` in FreeCAD's Python
console. This evaluates the `.FCStd` tool model with the bit's actual parameters
and exports the resulting surface mesh, including holes and asymmetric details.
It operates on temporary copies, closes those copies, and restores the previously
active document. It does not save changes to your documents or libraries.

```python
import importlib.util
spec = importlib.util.spec_from_file_location(
    "lcnc_export", "/path/to/lcnc-suite/scripts/freecad/export_library.py")
lcnc_export = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lcnc_export)
lcnc_export.export_library(
    "/path/to/Tools/Library/MyTools.fctl",
    "/path/to/MyTools.lcnc-tools.json",
    bit_dirs=["/path/to/additional/Bit"],
    shape_dirs=["/path/to/additional/Shape"],
)
```

Select the resulting `.json` using the same **Tools → Import** action. Sibling
`Bit` and `Shape` directories are found automatically; extra directories are only
needed when the library references assets elsewhere. The output must be a new
file. The export defaults to 0.01 mm tessellation tolerance; `tolerance=0.005`
requests a finer mesh. Maximum tolerance is 0.1 mm. This is a display mesh, not
an exact BRep or a replacement for CAM/collision validation.

The exporter currently supports a tool template with one `PartDesign::Body`
and one `PropertyBag`, including custom geometry in that body. It rejects failed
recomputes, invalid solids and unknown shape parameters. Multiple-body assemblies,
job/controller export and automatic extraction of separate cutting faces are
outside this import. Native bodies are shown as a single silver body; a mesh's
entire surface is not assumed to be cutting.

## Origins, lengths and identity

FreeCAD's `Length` is a model parameter, not a measured installation length.
For example, the standard probe extends from `-Length` to zero; the slitting
saw's cap extends below its CAM origin. LCNC translates the **physical bottom**
of either imported profile or mesh to Z=0 and keeps the original Z coordinate
in `source_z_min`. The preview calls out such an origin difference: the probing
reference for a saw or other special tool must agree with your machine/CAM
setup. This import does not change posted coordinates, G43 or measurement logic.

Changing a measured Z offset moves the tool using the existing signed LinuxCNC
offset; it never stretches the geometry. Editing table diameter or descriptive
fields also leaves a native shape fixed. Edit its geometry in FreeCAD and
re-import it. An explicit table replacement has different semantics from a
metadata refresh, which leaves the original `tool.tbl` bytes untouched.

Source UUIDs are retained when available. Legacy library bits use their file
stem as their FreeCAD asset identity; standalone bits without UUIDs use their
name. Renaming such an asset requires reviewing its identity conflict. A linked
FreeCAD tool cannot silently replace a linked Fusion tool, or vice versa.
The original bit parameters/attributes are saved in `source_metadata` for future
migration. Machining presets are not synthesized from library attributes.

## Validation and limits

Reference version: FreeCAD **1.1.3**, revision **20260725**, commit
`145529fe741292ff0b3977a01195bf0247425794`.

`test-fixtures/freecad/native-profiles.json` contains 42 native cases: all 14
shapes at three dimensional scales. Regenerate it with
`scripts/freecad/capture_profiles.py` inside FreeCAD. Backend tests compare the imported meridian
in both directions against the native sketch (1 µm chord tolerance), and compare
volume against the native revolved solid. Tests run in mm and inch. The suite
preserves native small shoulder offsets and type-specific angle meanings.

`custom-native.json` was generated from an asymmetric body with an axial bore.
Renderer tests verify the bore remains open and that both consumers receive
identical vertices after persistence. REST tests trap any tool-table write or
NML reload during metadata refresh. Browser tests exercise both import modes,
the custom-shape preview and the original Fusion workflow.

Limits: 16 MB upload, 32 MB expanded ZIP, 4096 archive entries, 2000 tools;
100,000 vertices / 200,000 triangles per native tool. Large JSON and all ZIP
imports run in the existing isolated parse-worker pipeline. Unsupported input
is reported before applying the library.

Upstream references:
- [CAM tool definitions](https://github.com/FreeCAD/FreeCAD/tree/main/src/Mod/CAM/Tools)
- [fctb serializer](https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/CAM/Path/Tool/toolbit/serializers/fctb.py)
- [fctl serializer](https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/CAM/Path/Tool/library/serializers/fctl.py)
