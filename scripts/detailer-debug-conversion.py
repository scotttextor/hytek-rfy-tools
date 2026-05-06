"""Step-by-step debug conversion — version 2: handles TdlgImport custom flow."""
import os, sys, time, subprocess
import psutil, pyautogui
from pywinauto import Application

EXE = r"C:\Program Files (x86)\FRAMECAD\Detailer\Version 5\FRAMECAD Detailer.exe"
XML = r"Y:\(17) 2026 HYTEK PROJECTS\CORAL HOMES\HG260017 LOT 925 (42) STUNNING CRESCENT NARANGBA\03 DETAILING\03 FRAMECAD DETAILER\01 XML OUTPUT\HG260017 LOT 925 (42) STUNNING CRESCENT NARANGBA-GF-LBW-70.075.xml"
OUT_DIR = r"C:\Users\Scott\CLAUDE CODE\hytek-rfy-tools\tmp_detailer_test"
OUT_RFY = os.path.join(OUT_DIR, "HG260017_GF-LBW-70.075.rfy")


def now(): return time.strftime("%H:%M:%S")


def find_pid():
    for p in psutil.process_iter(["pid", "name"]):
        if "Detailer" in (p.info["name"] or ""): return p.info["pid"]


def kill():
    for p in psutil.process_iter(["pid", "name"]):
        if "Detailer" in (p.info["name"] or ""):
            try: psutil.Process(p.info["pid"]).kill()
            except Exception: pass


def visible_windows(app):
    return [w for w in app.windows() if w.is_visible()]


def find_by_class(app, cls):
    for w in visible_windows(app):
        try:
            if w.class_name() == cls: return w
        except Exception: pass
    return None


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    kill(); time.sleep(1)

    print(f"[{now()}] Launching Detailer")
    subprocess.Popen([EXE], cwd=os.path.dirname(EXE))
    pid = None
    for _ in range(40):
        time.sleep(0.5)
        pid = find_pid()
        if pid: break
    print(f"[{now()}] PID {pid}")
    time.sleep(8)

    app = Application(backend="win32").connect(process=pid)
    main_win = find_by_class(app, "TfrmContainer")
    if not main_win:
        print("ERROR: no main window"); return 1
    print(f"[{now()}] Main: {main_win.window_text()!r}")
    main_win.set_focus(); time.sleep(0.5)

    # ---- Open Import -> XML dialog ----
    print(f"[{now()}] Alt+F -> i -> x")
    pyautogui.hotkey("alt", "f"); time.sleep(0.5)
    pyautogui.press("i"); time.sleep(0.4)
    pyautogui.press("x"); time.sleep(1.5)

    dlg = find_by_class(app, "TdlgImport")
    if not dlg:
        print("ERROR: TdlgImport not found"); return 2
    print(f"[{now()}] TdlgImport open")

    # ---- Click "Add" button to open file picker ----
    add_btn = None
    for c in dlg.descendants():
        try:
            if c.class_name() == "TButton" and c.window_text() == "Add":
                add_btn = c; break
        except Exception: pass
    if not add_btn:
        print("ERROR: Add button not found"); return 3
    print(f"[{now()}] Clicking Add")
    add_btn.click()
    time.sleep(1.5)

    # ---- Standard file picker should be up now ----
    file_dlg = None
    for w in visible_windows(app):
        try:
            if w.class_name() == "#32770":  # standard Windows file dialog
                file_dlg = w; break
        except Exception: pass
    if not file_dlg:
        print(f"[{now()}] No #32770 — listing windows:")
        for w in visible_windows(app):
            try: print(f"  class={w.class_name()!r}  text={w.window_text()!r}")
            except Exception: pass
        return 4
    print(f"[{now()}] File picker: {file_dlg.window_text()!r}")

    # The file dialog has a filename edit (control_id 0x47C historically).
    # Find any descendant Edit/ComboBox and set its text to the full XML path.
    print(f"[{now()}] Looking for filename edit field")
    file_edit = None
    for c in file_dlg.descendants():
        try:
            cls = c.class_name()
            if cls in ("Edit", "ComboBoxEx32") or "ComboBox" in cls:
                # Heuristic: skip tiny ones (system controls)
                r = c.rectangle()
                if r.width() > 100:
                    file_edit = c
                    print(f"  edit: class={cls!r} rect={r}")
                    break
        except Exception: pass
    if not file_edit:
        print("ERROR: no filename edit found in #32770")
        for c in file_dlg.descendants():
            try: print(f"  desc class={c.class_name()!r} rect={c.rectangle()}")
            except: pass
        return 5
    file_edit.set_focus(); time.sleep(0.2)
    # Triple-click to select existing text, then type
    try:
        file_edit.set_edit_text(XML)
    except Exception as e:
        print(f"set_edit_text failed: {e}; falling back to typing")
        # Clear + type via pyautogui
        pyautogui.hotkey("ctrl", "a"); time.sleep(0.1)
        pyautogui.press("delete"); time.sleep(0.1)
        pyautogui.typewrite(XML, interval=0.005)
    time.sleep(0.5)
    pyautogui.press("enter")
    time.sleep(2)

    # ---- Wait for file picker to close ----
    print(f"[{now()}] Waiting for picker to close...")
    for _ in range(20):
        time.sleep(0.5)
        if not find_by_class(app, "#32770"):
            break
    if find_by_class(app, "#32770"):
        print("ERROR: file picker still open"); return 5
    print(f"[{now()}] File picker closed")

    # ---- Verify TdlgImport now has the XML in its TCheckListBox ----
    dlg = find_by_class(app, "TdlgImport")
    time.sleep(0.5)
    if dlg:
        cb = None
        for c in dlg.descendants():
            try:
                if c.class_name() == "TCheckListBox":
                    cb = c; break
            except Exception: pass
        if cb:
            try:
                texts = cb.item_texts() if hasattr(cb, "item_texts") else []
                print(f"[{now()}] CheckListBox items: {texts}")
                # Check if items are CHECKED. TCheckListBox in pywinauto win32 may
                # not expose check state directly — try clicking each item to ensure
                # it's checked. Send space to toggle.
                cb_rect = cb.rectangle()
                # Click on the FIRST item's checkbox area (~12px from left edge of item)
                # CheckListBox items are ~16px tall typically.
                # We don't know exact y, so let's just send Ctrl+A then space to check all
                cb.set_focus(); time.sleep(0.2)
                pyautogui.click(cb_rect.left + 20, cb_rect.top + 12)  # click first item
                time.sleep(0.3)
                # Press Space to toggle checkbox of focused item
                pyautogui.press("space")
                time.sleep(0.3)
                print(f"[{now()}] Pressed space on item 0 (toggle check)")
                # Also click the "Select All" button as a safety
                for c2 in dlg.descendants():
                    try:
                        if c2.class_name() == "TButton" and c2.window_text() == "Select All":
                            print(f"[{now()}] Clicking Select All")
                            c2.click_input()
                            time.sleep(0.5)
                            break
                    except Exception: pass
            except Exception as e:
                print(f"  CheckListBox handling error: {e}")

    # ---- Skip the combo-setting; click Import + Ignore errors to see if it proceeds ----
    SKIP_COMBO_SET = True
    if SKIP_COMBO_SET:
        print(f"[{now()}] DEBUG: skipping combo-set, will click Import + Ignore errors")
        # ---- Click Import button right away ----
        import_btn = None
        for c in dlg.descendants():
            try:
                if c.class_name() == "TButton" and c.window_text() == "Import":
                    import_btn = c; break
            except Exception: pass
        if not import_btn:
            print("ERROR: Import button not found"); return 6
        r = import_btn.rectangle()
        cx, cy = (r.left + r.right) // 2, (r.top + r.bottom) // 2
        print(f"[{now()}] Clicking Import (rect={r}, center=({cx},{cy})) via pyautogui")
        try:
            dlg.set_focus(); time.sleep(0.3)
        except Exception: pass
        # Move mouse to the button + click via pyautogui
        pyautogui.moveTo(cx, cy, duration=0.2)
        time.sleep(0.3)
        pyautogui.click()
        time.sleep(2)
        # Auto-click Ignore on any error dialog within 60s
        for i in range(120):
            time.sleep(0.5)
            for w in visible_windows(app):
                try:
                    if w.class_name() == "TMessageForm":
                        for c in w.descendants():
                            try:
                                if c.class_name() == "TButton" and "Ignore" in c.window_text():
                                    print(f"  [{now()}] dismiss {w.window_text()!r} via Ignore")
                                    c.click(); time.sleep(1); break
                            except Exception: pass
                        break
                except Exception: pass
            try:
                t = main_win.window_text()
                if "untitled" not in t.lower() and ".fcp" in t.lower():
                    print(f"[{now()}] IMPORT SUCCESS! title={t!r}")
                    final_title = t
                    return 0
            except Exception: pass
        # Else fall through
        print(f"[{now()}] still untitled, trying combo-set path")
        return 99

    # Plan-name pattern: "GF-<TYPE>-<WEB>.<GAUGE>" e.g. "GF-LBW-70.075", "GF-NLBW-89.075".
    import re as _re
    profile_match = _re.search(r"-(70|75|78|89|90|104)\.\d+", os.path.basename(XML))
    web = profile_match.group(1) if profile_match else "70"
    print(f"[{now()}] Detected web profile: {web}mm")
    is_truss = "-TB2B-" in XML or "-TIN-" in XML
    if web == "89":
        wall_setup = "F325iT 89mm"
        truss_setup = "F325iT 89mm B2B Centre Hole"
        joist_setup = "F325iT 89mm Joist"
    elif web == "104":
        wall_setup = "F325iT 104mm"
        truss_setup = "F325iT 104mm"
        joist_setup = "F325iT 104mm"
    elif web == "75":
        wall_setup = "F325iT 75mm"
        truss_setup = "F325iT 75mm"
        joist_setup = "F325iT 75mm"
    elif web == "78":
        wall_setup = "F325iT 78mm"
        truss_setup = "F325iT 78mm"
        joist_setup = "F325iT 78mm"
    elif web == "90":
        wall_setup = "F325iT 90mm (PERTH)"
        truss_setup = "F325iT 90mm (PERTH)"
        joist_setup = "F325iT 90mm (PERTH)"
    else:
        wall_setup = "F325iT 70mm"
        truss_setup = "F325iT 70mm B2B Centre Hole"
        joist_setup = "F325iT 70mm"

    # The TdlgImport machine-setup combos are at known y-positions per group
    # (External Wall, Internal Wall, Truss, Joist, Miscellaneous, Roof Panel,
    # Floor Panel, Ceiling Panel). Iterate and select.
    print(f"[{now()}] Setting machine setups: wall={wall_setup}, truss={truss_setup}, joist={joist_setup}")
    combos = []
    for c in dlg.descendants():
        try:
            if c.class_name() == "TComboBox":
                r = c.rectangle()
                # Machine-setup combos have left around 468-470 and width ~220
                if r.left in range(465, 475):
                    combos.append((r.top, c))
        except Exception: pass
    # Sort by top descending — TdlgImport groups are stacked from External Wall (top) down
    # but rect.top values: External Wall=144, Internal=278, Truss=425, Joist=545,
    # Misc=671, Roof=786, Floor=910, Ceiling=1038. So ascending top = visual top-to-bottom.
    combos.sort(key=lambda t: t[0])
    # Pair (machine setup, tool action) — every 2 combos = (machine, action) for one group.
    # Top 8 group-machine combos are at: 144 (Ext Wall), 278 (Int Wall), 425 (Truss),
    # 545 (Joist), 671 (Misc), 786 (Roof), 910 (Floor), 1038 (Ceiling).
    # Top 8 group-tool-action combos are at: 184, 319, 459, 579, 714, 829, 953, 1080.
    # We want to set the 8 machine-setup ones (the ones at smaller top values per group).
    setup_targets = [
        wall_setup,    # External Wall
        wall_setup,    # Internal Wall
        truss_setup,   # Truss
        joist_setup,   # Joist
        wall_setup,    # Miscellaneous
        wall_setup,    # Roof Panel
        joist_setup,   # Floor Panel
        wall_setup,    # Ceiling Panel
    ]
    # Identify the 8 machine-setup combos: those whose current text is a known setup name (e.g. "Demo Machine Setup")
    machine_combos = [c for top, c in combos if "Demo Machine Setup" in c.window_text() or "F325" in c.window_text()]
    print(f"[{now()}] found {len(machine_combos)} machine-setup combos")
    for i, c in enumerate(machine_combos[:8]):
        target = setup_targets[i] if i < len(setup_targets) else wall_setup
        try:
            c.select(target)
            print(f"  [{i}] selected {target!r}")
        except Exception as e:
            # Fallback: click + type + enter
            try:
                c.click()
                time.sleep(0.2)
                pyautogui.hotkey("ctrl", "a"); pyautogui.press("delete")
                pyautogui.typewrite(target, interval=0.005)
                pyautogui.press("enter")
                print(f"  [{i}] typed {target!r}")
            except Exception as e2:
                print(f"  [{i}] FAILED: {e} / {e2}")
        time.sleep(0.3)

    # ---- Click Import button ----
    if dlg:
        import_btn = None
        for c in dlg.descendants():
            try:
                if c.class_name() == "TButton" and c.window_text() == "Import":
                    import_btn = c; break
            except Exception: pass
        if not import_btn:
            print("ERROR: Import button not found"); return 6
        print(f"[{now()}] Clicking Import (rect={import_btn.rectangle()})")
        # Try double-click + screenshot to verify
        import_btn.click()
        time.sleep(0.5)
        # Screenshot full screen RIGHT AFTER click
        full = pyautogui.screenshot()
        full_path = os.path.join(OUT_DIR, "after-import-click.png")
        full.save(full_path)
        print(f"[{now()}] Full screenshot: {full_path}")
        time.sleep(2)
    else:
        print("ERROR: TdlgImport disappeared after picker close"); return 7

    # ---- Wait for import to complete; screenshot every popup, then bail ----
    print(f"[{now()}] Waiting up to 60s, screenshotting all popups...")
    final_title = None
    seen_popups = set()
    for i in range(120):
        time.sleep(0.5)
        try:
            t = main_win.window_text()
            if "untitled" not in t.lower() and ".fcp" in t.lower():
                final_title = t
                break
        except Exception: pass
        # Snapshot any popup we haven't seen yet
        for w in visible_windows(app):
            try:
                if w.class_name() == "TMessageForm":
                    r = w.rectangle()
                    sig = (w.window_text(), r.left, r.top, r.width(), r.height())
                    if sig in seen_popups:
                        continue
                    seen_popups.add(sig)
                    img = pyautogui.screenshot(region=(r.left, r.top, r.width(), r.height()))
                    n = len(seen_popups)
                    p = os.path.join(OUT_DIR, f"popup-{n}-{w.window_text()}.png")
                    img.save(p)
                    btns = []
                    for c in w.descendants():
                        try:
                            if c.class_name() == "TButton":
                                btns.append(c.window_text())
                        except Exception: pass
                    print(f"  [{now()}] popup {n}: {w.window_text()!r} btns={btns}")
                    print(f"           screenshot: {p}")
            except Exception: pass
    print(f"[{now()}] Final main title: {final_title!r}")
    print(f"[{now()}] Total popups captured: {len(seen_popups)}")

    # Probe project state via main window's children
    print(f"[{now()}] Main window descendants (text-bearing only):")
    n_shown = 0
    for c in main_win.descendants():
        try:
            t = c.window_text()
            cls = c.class_name()
            if t and len(t) < 80 and not t.startswith("FRAMECAD"):
                print(f"  class={cls!r:30s} text={t!r}")
                n_shown += 1
                if n_shown >= 30:
                    break
        except Exception: pass

    if not final_title:
        print(f"[{now()}] STILL UNTITLED — windows now:")
        for w in visible_windows(app):
            try: print(f"  class={w.class_name()!r}  text={w.window_text()!r}")
            except Exception: pass
        # Screenshot the error dialog so we can read the text
        try:
            for w in visible_windows(app):
                if w.class_name() == "TMessageForm":
                    r = w.rectangle()
                    print(f"  Error dialog rect={r}")
                    img = pyautogui.screenshot(region=(r.left, r.top, r.width(), r.height()))
                    p = os.path.join(OUT_DIR, "detailer-error-dialog.png")
                    img.save(p)
                    print(f"  saved screenshot: {p}")
                    break
        except Exception as e:
            print(f"screenshot failed: {e}")
        # Probe TMessageForm error via UIA
        try:
            from pywinauto import Application as App2
            uia = App2(backend="uia").connect(process=pid)
            for w in uia.windows():
                try:
                    if w.window_text() == "Error":
                        print(f"\n[{now()}] UIA ERROR DIALOG:")
                        for d in w.descendants():
                            try:
                                t = d.window_text()
                                ct = d.element_info.control_type
                                if t:
                                    print(f"  ctype={ct} text={t!r}")
                            except Exception: pass
                        break
                except Exception: pass
        except Exception as e:
            print(f"UIA probe failed: {e}")
        # Click Ignore and continue
        for w in visible_windows(app):
            try:
                if w.class_name() == "TMessageForm":
                    for c in w.descendants():
                        try:
                            if c.class_name() == "TButton" and "Ignore" in c.window_text():
                                print(f"[{now()}] Clicking Ignore")
                                c.click(); time.sleep(2)
                                break
                        except Exception: pass
                    break
            except Exception: pass
        # Re-check title after ignoring
        time.sleep(3)
        for _ in range(60):
            time.sleep(0.5)
            try:
                t = main_win.window_text()
                if "untitled" not in t.lower() and ".fcp" in t.lower():
                    final_title = t
                    print(f"[{now()}] Title after ignoring error: {t!r}")
                    break
            except Exception: pass
        if not final_title:
            return 8

    # ---- Now try the Export RFY path ----
    print(f"\n[{now()}] === IMPORT DONE — now trying Export RFY ===")
    main_win.set_focus(); time.sleep(0.5)
    pyautogui.hotkey("alt", "f"); time.sleep(0.5)
    pyautogui.press("e"); time.sleep(0.4)
    pyautogui.press("r"); time.sleep(1.5)

    print(f"[{now()}] Windows after Export -> RFY:")
    for w in visible_windows(app):
        try: print(f"  class={w.class_name()!r}  text={w.window_text()!r}")
        except Exception: pass

    return 0


if __name__ == "__main__":
    try: rc = main()
    except Exception as e:
        import traceback; traceback.print_exc(); rc = 99
    sys.exit(rc)
