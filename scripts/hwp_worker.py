import argparse
import json
import os
import re
import shutil
import sys
import time
import unicodedata
from datetime import date
from pathlib import Path


def default_work_root():
    public_root = os.environ.get("PUBLIC")
    if public_root:
        return Path(public_root) / "Documents" / "HwpAutofill" / "jobs"
    return Path("C:/HwpAutofill/jobs")


ASCII_WORK_ROOT = Path(os.environ.get("HWP_AUTOFILL_TEMP_DIR") or default_work_root())


def flatten_value(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "동의함" if value else "사용자 확인 필요"
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        lines = []
        for index, item in enumerate(value, start=1):
            if isinstance(item, dict):
                parts = [str(v) for v in item.values() if v]
                lines.append(f"{index}. " + " / ".join(parts))
            else:
                lines.append(f"{index}. {item}")
        return "\r\n".join(lines)
    if isinstance(value, dict):
        return " / ".join(str(v) for v in value.values() if v)
    return str(value)


def normalize_text(value, compact_dates=False):
    text = unicodedata.normalize("NFKC", flatten_value(value))
    text = text.replace("\u00a0", " ")
    text = text.replace("`", "'").replace("‘", "'").replace("’", "'")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\(\s+", "(", text)
    text = re.sub(r"\s+\)", ")", text)
    text = re.sub(r"(?<!\()주\)\s*이산", "(주)이산", text)
    if compact_dates:
        previous = None
        while previous != text:
            previous = text
            text = re.sub(r"(\d{1,4})\.\s+(\d{1,2})", r"\1.\2", text)
        text = re.sub(r"\s*~\s*", "~", text)
    return text


def insert_text(hwp, text):
    params = hwp.HParameterSet.HInsertText
    hwp.HAction.GetDefault("InsertText", params.HSet)
    params.Text = text
    return hwp.HAction.Execute("InsertText", params.HSet)


def find_text(hwp, text):
    params = hwp.HParameterSet.HFindReplace
    hwp.HAction.GetDefault("RepeatFind", params.HSet)
    params.FindString = text
    params.Direction = 1
    params.IgnoreMessage = 1
    params.MatchCase = 0
    params.WholeWordOnly = 0
    params.UseWildCards = 0
    params.FindType = 1
    params.ReplaceMode = 0
    return hwp.HAction.Execute("RepeatFind", params.HSet)


def replace_found_text(hwp, find_string, replacement, max_count=1):
    count = 0
    hwp.Run("MoveDocBegin")
    for _ in range(max_count):
        if not find_text(hwp, find_string):
            break
        apply_cell_style(hwp, align="center", size=950, ratio=96, line_spacing=110)
        insert_text(hwp, replacement)
        count += 1
    return count


def replace_line_from_match(hwp, find_string, replacement, align="left"):
    hwp.Run("MoveDocBegin")
    if not find_text(hwp, find_string):
        return False
    found_list, found_para, _ = hwp.GetPos()
    hwp.SetPos(found_list, found_para, 0)
    hwp.Run("MoveSelParaEnd")
    hwp.Run("Delete")
    apply_cell_style(hwp, align=align, size=950, ratio=96, line_spacing=110)
    insert_text(hwp, replacement)
    return True


def today_strings():
    today = date.today()
    return {
        "dot": f"{today.year}. {today.month}. {today.day}.",
        "korean": f"{today.year}년 {today.month}월 {today.day}일",
    }


def apply_cell_style(hwp, align="left", size=850, ratio=92, spacing=0, line_spacing=105):
    char_shape = hwp.HParameterSet.HCharShape
    hwp.HAction.GetDefault("CharShape", char_shape.HSet)
    char_shape.Height = int(size)
    for attr in [
        "RatioHangul",
        "RatioHanja",
        "RatioJapanese",
        "RatioLatin",
        "RatioOther",
        "RatioSymbol",
        "RatioUser",
    ]:
        setattr(char_shape, attr, int(ratio))
    for attr in [
        "SpacingHangul",
        "SpacingHanja",
        "SpacingJapanese",
        "SpacingLatin",
        "SpacingOther",
        "SpacingSymbol",
        "SpacingUser",
    ]:
        setattr(char_shape, attr, int(spacing))
    try:
        char_shape.UseKerning = 1
        char_shape.UseFontSpace = 0
    except Exception:
        pass
    hwp.HAction.Execute("CharShape", char_shape.HSet)

    para_shape = hwp.HParameterSet.HParaShape
    hwp.HAction.GetDefault("ParaShape", para_shape.HSet)
    para_shape.AlignType = {"left": 0, "right": 1, "center": 2, "justify": 3}.get(align, 0)
    para_shape.LineSpacingType = 0
    para_shape.LineSpacing = int(line_spacing)
    para_shape.LeftMargin = 0
    para_shape.RightMargin = 0
    para_shape.PrevSpacing = 0
    para_shape.NextSpacing = 0
    try:
        para_shape.BreakNonLatinWord = 0
        para_shape.BreakLatinWord = 1
        para_shape.AutoSpaceEAsianEng = 0
        para_shape.AutoSpaceEAsianNum = 0
    except Exception:
        pass
    hwp.HAction.Execute("ParaShape", para_shape.HSet)


def value_map(draft):
    return {item.get("id"): item.get("value") for item in draft.get("values", [])}


def truthy(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return normalize_text(value).lower() in {"true", "1", "yes", "y", "동의", "동의함", "checked"}


def fill_privacy_agreement(hwp, draft_values):
    agree = truthy(draft_values.get("privacyAgreement"))
    agree_text = "☑ 동의함    □ 동의하지 않음" if agree else "□ 동의함    ☑ 동의하지 않음"
    line = f"개인정보 수집·이용에 동의하십니까?           {agree_text}"
    if insert_cell(hwp, 98, line, style={"align": "left", "size": 820, "ratio": 88}, clear_all=True):
        return 1
    return 0


def fill_dates_and_signatures(hwp, payload):
    profile = payload.get("profile", {})
    person = profile.get("person", {})
    work = profile.get("work", {})
    name = normalize_text(person.get("nameKo", ""))
    company = normalize_text(work.get("company", ""))
    values = value_map(payload.get("draft", {}))
    today = today_strings()
    filled = 0

    filled += fill_privacy_agreement(hwp, values)

    filled += replace_found_text(hwp, "2026.     .     .", today["dot"], max_count=2)

    if replace_line_from_match(
        hwp,
        "작성자",
        f"작성자 : {name}                 (서명 또는 인)",
        align="left",
    ):
        filled += 1

    signer_line = f"서약자 : 소속 {company}              성명 {name}              (서명 또는 인)"
    if replace_line_from_match(hwp, "서약자", signer_line, align="left"):
        filled += 1

    # 개인정보 동의서 표 상단의 성명/생년월일 칸도 같이 채운다.
    if name:
        insert_cell(hwp, 93, name, style={"align": "center", "size": 900, "ratio": 95})
        filled += 1
    if person.get("birthDate"):
        insert_cell(hwp, 95, person.get("birthDate"), style={"align": "center", "size": 850, "ratio": 92})
        filled += 1

    # 개인정보 동의서 하단은 한 셀 안에 날짜/성명/수신처가 함께 있어 셀 전체를 정리한다.
    if name:
        bottom_line = f"{today['korean']}                                                성명 : {name}             (서명 또는 인)     정선군수 귀하"
        if insert_cell(hwp, 99, bottom_line, style={"align": "left", "size": 820, "ratio": 88}, clear_all=True):
            filled += 1
    return filled


def find_table_anchors(hwp):
    anchors = []
    ctrl = hwp.HeadCtrl
    while ctrl:
        try:
            if ctrl.CtrlID == "tbl":
                anchor = ctrl.GetAnchorPos(0)
                anchors.append(
                    {
                        "list": anchor.Item("List"),
                        "para": anchor.Item("Para"),
                        "pos": anchor.Item("Pos"),
                    }
                )
        except Exception:
            pass
        try:
            ctrl = ctrl.Next
        except Exception:
            break
    return anchors


def clear_cell(hwp, cell_list_id, all_content=False):
    hwp.SetPos(cell_list_id, 0, 0)
    try:
        hwp.Run("SelectAll" if all_content else "MoveSelParaEnd")
        hwp.Run("Delete")
    except Exception:
        pass
    hwp.SetPos(cell_list_id, 0, 0)


def insert_cell(hwp, cell_list_id, text, clear=True, style=None, compact_dates=False, clear_all=False):
    text = normalize_text(text, compact_dates=compact_dates)
    if not text:
        return False
    if clear:
        clear_cell(hwp, cell_list_id, all_content=clear_all)
    else:
        hwp.SetPos(cell_list_id, 0, 0)
    apply_cell_style(hwp, **(style or {}))
    insert_text(hwp, text)
    return True


def fill_rows(hwp, rows, items, formatter, styles):
    count = 0
    for row_cells, item in zip(rows, items or []):
        values = formatter(item)
        for index, (cell_id, value) in enumerate(zip(row_cells, values)):
            style = styles[index] if index < len(styles) else {}
            if insert_cell(hwp, cell_id, value, style=style, compact_dates=index == 0):
                count += 1
    return count


def education_values(item):
    return [
        item.get("period", ""),
        normalize_text(item.get("school", "")),
        normalize_text(item.get("degree", "")),
        normalize_text(item.get("major", "")),
    ]


def split_committee_content(content):
    text = normalize_text(content)
    note = ""
    match = re.search(r"\(([^()]*)\)", text)
    if match:
        note = match.group(1)
        text = (text[: match.start()] + text[match.end() :]).strip()
    if "겸임교수" in text:
        org = text.split("겸임교수", 1)[0].strip()
        return [org, "겸임교수", note]
    for suffix in ["심의위원회", "위원회", "위원단"]:
        if suffix in text:
            org, rest = text.split(suffix, 1)
            org = f"{org}{suffix}".strip()
            position = "위원" if "위원" in rest else rest.strip()
            return [org, position or "위원", note]
    if "심의위원" in text:
        org = text.split("심의위원", 1)[0].strip()
        return [org, "심의위원", note]
    if "위원" in text:
        org = re.sub(r"\s*위원.*$", "", text).strip()
        return [org or text, "위원", note]
    return [text, "", note]


def career_values(item):
    if "organization" in item:
        return [
            item.get("period", ""),
            normalize_text(item.get("organization", "")),
            normalize_text(item.get("position", "")),
            normalize_text(item.get("duty", "")),
        ]
    org, position, duty = split_committee_content(item.get("content", ""))
    return [item.get("period", ""), org, position, duty]


def license_values(item):
    return [
        item.get("acquiredDate", ""),
        normalize_text(item.get("name", "")),
        normalize_text(item.get("issuer", "")),
        normalize_text(item.get("number") or item.get("note", "")),
    ]


def fill_jungsun_application_table(hwp, payload):
    profile = payload.get("profile", {})
    draft = payload.get("draft", {})
    person = profile.get("person", {})
    work = profile.get("work", {})
    values = value_map(draft)

    anchors = find_table_anchors(hwp)
    if not anchors:
        return {"filled": 0, "reason": "no table controls found"}

    # The first table in the sample public notice is [붙임 1] registration form.
    app_table = anchors[0]
    filled = 0
    hwp.SetPos(app_table["list"], app_table["para"], app_table["pos"])
    hwp.Run("MoveRight")

    scalar_cells = [
        (3, values.get("nameKo") or person.get("nameKo", ""), {"align": "center", "size": 900, "ratio": 95}),
        (5, values.get("birthDate") or person.get("birthDate", ""), {"align": "center", "size": 850, "ratio": 92}),
        (7, values.get("recruitField", ""), {"align": "center", "size": 850, "ratio": 92}),
        (10, values.get("addressHome") or person.get("addressHome", ""), {"align": "left", "size": 800, "ratio": 88}),
        (12, person.get("phoneHome", ""), {"align": "center", "size": 850, "ratio": 92}),
        (14, values.get("mobile") or person.get("mobile", ""), {"align": "center", "size": 850, "ratio": 92}),
        (17, values.get("workCompany") or work.get("company", ""), {"align": "left", "size": 850, "ratio": 92}),
        (19, values.get("workPosition") or work.get("position", ""), {"align": "center", "size": 850, "ratio": 92}),
        (21, work.get("address", ""), {"align": "left", "size": 800, "ratio": 88}),
        (23, work.get("phone", ""), {"align": "center", "size": 850, "ratio": 92}),
        (25, work.get("fax", ""), {"align": "center", "size": 850, "ratio": 92}),
        (27, values.get("email") or person.get("email", ""), {"align": "center", "size": 850, "ratio": 92}),
    ]
    for cell_id, value, style in scalar_cells:
        if insert_cell(hwp, cell_id, value, style=style):
            filled += 1

    date_style = {"align": "center", "size": 760, "ratio": 88, "line_spacing": 100}
    left_style = {"align": "left", "size": 760, "ratio": 86, "line_spacing": 100}
    center_style = {"align": "center", "size": 760, "ratio": 88, "line_spacing": 100}
    filled += fill_rows(
        hwp,
        [(33, 34, 35, 36), (37, 38, 39, 40), (41, 42, 43, 44), (45, 46, 47, 48)],
        values.get("education") or profile.get("education", []),
        education_values,
        [date_style, left_style, center_style, left_style],
    )
    filled += fill_rows(
        hwp,
        [(54, 55, 56, 57), (58, 59, 60, 61), (62, 63, 64, 65), (66, 67, 68, 69)],
        values.get("careers") or profile.get("careers", []),
        career_values,
        [date_style, left_style, center_style, left_style],
    )
    filled += fill_rows(
        hwp,
        [(75, 76, 77, 78), (79, 80, 81, 82), (83, 84, 85, 86)],
        values.get("licenses") or profile.get("licenses", []),
        license_values,
        [date_style, left_style, left_style, center_style],
    )

    return {"filled": filled, "tableAnchor": app_table}


def build_hwp(template_path, draft_path, output_path):
    import win32com.client

    with open(draft_path, "r", encoding="utf-8") as file:
        payload = json.load(file)

    job_id = Path(output_path).stem.replace(" ", "_")
    job_dir = ASCII_WORK_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    ascii_template = job_dir / "template.hwp"
    ascii_output = job_dir / "output.hwp"
    shutil.copyfile(template_path, ascii_template)
    open_path = str(ascii_template.resolve())

    def open_template(hwp):
        attempts = [
            ("basic", lambda: hwp.Open(open_path)),
            ("forceopen", lambda: hwp.Open(open_path, "HWP", "forceopen:true")),
            (
                "forceopen-lock-false",
                lambda: hwp.Open(open_path, "HWP", "forceopen:true;lock:false;versionwarning:false"),
            ),
        ]
        errors = []
        for label, action in attempts:
            try:
                if action():
                    return True
                errors.append(f"{label}: returned false")
            except Exception as exc:
                errors.append(f"{label}: {type(exc).__name__}: {exc}")
        raise RuntimeError(
            "HWP_OPEN_FAILED. "
            "Run Hancom HWP once on this PC, close first-run/security popups, then retry. "
            f"path={open_path}; exists={ascii_template.exists()}; size={ascii_template.stat().st_size if ascii_template.exists() else 0}; "
            f"attempts={' | '.join(errors)}"
        )

    try:
        hwp = win32com.client.gencache.EnsureDispatch("HWPFrame.HwpObject")
    except Exception:
        try:
            hwp = win32com.client.DispatchEx("HWPFrame.HwpObject")
        except Exception:
            hwp = win32com.client.Dispatch("HWPFrame.HwpObject")
    try:
        try:
            hwp.XHwpWindows.Item(0).Visible = False
        except Exception:
            pass

        try:
            hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
        except Exception:
            pass

        try:
            opened = open_template(hwp)
        except Exception:
            try:
                hwp.XHwpWindows.Item(0).Visible = True
                time.sleep(0.5)
            except Exception:
                pass
            opened = open_template(hwp)
        if not opened:
            raise RuntimeError(f"HWP open failed: {ascii_template}")

        fill_result = fill_jungsun_application_table(hwp, payload)
        signature_count = fill_dates_and_signatures(hwp, payload)

        saved = hwp.SaveAs(str(ascii_output), "HWP", "")
        if not saved:
            raise RuntimeError(f"HWP save failed: {ascii_output}")
    finally:
        try:
            hwp.Quit()
        except Exception:
            pass

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ascii_output, output)
    return {
        "ok": True,
        "output": str(output),
        "asciiOutput": str(ascii_output),
        "mode": "fill-application-table",
        "fillResult": fill_result,
        "signatureCount": signature_count,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", required=True)
    parser.add_argument("--draft", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    if sys.platform != "win32":
        raise SystemExit("HWP COM worker requires Windows.")

    try:
        result = build_hwp(args.template, args.draft, args.output)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        error = {
            "ok": False,
            "error": str(exc),
            "type": type(exc).__name__,
        }
        print(json.dumps(error, ensure_ascii=False))
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
