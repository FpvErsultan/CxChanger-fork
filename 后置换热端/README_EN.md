# Rear-Mounted Hotend Project

This folder contains the mesh model and motion parameters for a rear-mounted hotend/dock project. Before installation or motion, verify the model revision, mounting orientation, machine coordinate system, and available travel.

## Files

- `后置换热端完整全套 修复版本.stl`: the complete repaired STL mesh supplied for this project. STL does not contain a parametric feature tree and cannot be edited like a STEP solid; use suitable mesh or CAD software if geometry changes are needed.
- `dock_motion_parameters.txt`: the original Chinese dock-motion parameter snippet. The parameters are explained below.

## Dock motion parameters

```ini
variable_dock_shift_x: 3
variable_dock_dodge_y: -14
variable_dock_safe_y: -30
```

- `variable_dock_shift_x`: X-axis shift used to open or close the extruder arm.
- `variable_dock_dodge_y`: relative Y-axis clearance move.
- `variable_dock_safe_y`: relative Y-axis move for safely withdrawing from the dock.

The values are preserved from the supplied configuration. The source does not identify the coordinate reference, macro names, or compatible printer models. Check the actual Klipper macros for direction, units, and move order; do not assume every printer uses the same coordinate system.

## Klipper integration and commissioning

1. Back up the current configuration and find the dock/tool-change macro that reads these variables.
2. Put the values in the variable-definition section used by that macro. This is only a parameter snippet, not a complete `printer.cfg` or standalone macro file.
3. Check axis directions, travel limits, dock position, and clearance from the frame, toolhead, wiring, and other hotends.
4. Run the macro outside a print at low speed, ready to stop motion. Verify each direction and clearance move step by step before a full docking cycle.
5. After changing values, reload the Klipper configuration using your normal procedure and re-check every tool-change path.

If motion collides, binds, or differs from the expected path, stop immediately. Re-check the coordinate system, variable references, and clearance before proceeding. Do not try to solve an unknown path problem by simply increasing travel distances.

## Model and printing

Before use, check the STL units, scale, mesh integrity, and mounting orientation, then verify compatibility with the target printer. This folder does not specify dimensional tolerances, print material, slicer settings, or a complete macro, so validate those details for the actual hardware and machine configuration.

## 中文

参见 [README.md](README.md) 查看中文版。
