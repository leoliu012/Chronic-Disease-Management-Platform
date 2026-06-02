#!/usr/bin/env python3
"""
care_reminders_medication_h5_submit_fix

Fixes care-reminders smoke failures:
- medication H5 submit returns 400 because SubmitPublicMedicationCheckInDto requires
  medicationId, while care reminder links already carry medicationId in formLink.payload.
- Controller should infer medicationId from the token payload when elderly-friendly H5
  submit only sends { taken, note }.

Run from repo root:
  python3 scripts/apply_care_reminders_medication_h5_submit_fix.py
"""

from pathlib import Path
import re
import sys

ROOT = Path.cwd()
DTO = ROOT / "apps/api/src/patient-engagement/dto/submit-public.dto.ts"
CTRL = ROOT / "apps/api/src/patient-engagement/public-form.controller.ts"

def fail(msg: str) -> None:
    print(f"[err] {msg}", file=sys.stderr)
    sys.exit(1)

def patch_dto() -> bool:
    if not DTO.exists():
        fail(f"missing {DTO}")
    src = DTO.read_text()
    old = """export class SubmitPublicMedicationCheckInDto {
  @IsOptional()
  @IsString()
  formSessionToken?: string;

  @IsString()
  medicationId!: string;
"""
    new = """export class SubmitPublicMedicationCheckInDto {
  @IsOptional()
  @IsString()
  formSessionToken?: string;

  // Optional for care-reminder H5 links: medicationId is embedded in
  // PatientFormLink.payload by the reminder worker, so elderly users only
  // need to tap "我已服药 / 今天未服药".
  @IsOptional()
  @IsString()
  medicationId?: string;
"""
    if new in src:
        print("[skip] submit-public.dto.ts already allows payload-derived medicationId")
        return False
    if old not in src:
        # Handle a narrower pre-existing optional marker as already OK.
        if re.search(r"class\s+SubmitPublicMedicationCheckInDto[\s\S]*?@IsOptional\(\)\s*\n\s*@IsString\(\)\s*\n\s*medicationId\?:\s*string;", src):
            print("[skip] submit-public.dto.ts medicationId already optional")
            return False
        fail("could not find SubmitPublicMedicationCheckInDto medicationId required block")
    DTO.write_text(src.replace(old, new))
    print("[ok] patched submit-public.dto.ts")
    return True

def patch_controller() -> bool:
    if not CTRL.exists():
        fail(f"missing {CTRL}")
    src = CTRL.read_text()
    marker = "const medicationId = this.resolveMedicationIdForPublicCheckIn(dto, formLink);"
    if marker in src:
        print("[skip] public-form.controller.ts already infers medicationId from payload")
        return False

    old = """    const medication = await this.prisma.medicationRecord.findUnique({ where: { id: dto.medicationId } });
    if (!medication || medication.patientId !== formLink.patientId) {
      throw new NotFoundException('用药计划不存在');
    }

    const checkedAt = dto.checkedAt ? new Date(dto.checkedAt) : new Date();
"""
    new = """    const medicationId = this.resolveMedicationIdForPublicCheckIn(dto, formLink);
    const medication = await this.prisma.medicationRecord.findUnique({ where: { id: medicationId } });
    if (!medication || medication.patientId !== formLink.patientId) {
      throw new NotFoundException('用药计划不存在');
    }

    const checkedAt = dto.checkedAt ? new Date(dto.checkedAt) : new Date();
"""
    if old not in src:
        fail("could not find medication lookup block in submitMedicationCheckIn")
    src = src.replace(old, new, 1)

    helper = """
  // ---------------------------------------------------------------------------
  // v3 care-reminder medication links may intentionally omit medicationId from
  // the request body. The link payload already contains it. This keeps the H5 UI
  // elderly-friendly: patients only tap "taken / not taken".
  // ---------------------------------------------------------------------------
  private resolveMedicationIdForPublicCheckIn(
    dto: SubmitPublicMedicationCheckInDto,
    formLink: { payload: unknown },
  ): string {
    const payload: any = formLink.payload || {};
    const medicationId =
      dto.medicationId ||
      payload.medicationId ||
      (payload.sourceType === 'MEDICATION' ? payload.sourceId : null);

    if (!medicationId || typeof medicationId !== 'string') {
      throw new BadRequestException({
        code: 'MEDICATION_ID_MISSING',
        message: '用药打卡链接缺少用药计划信息，请联系医院重新发送。',
      });
    }

    return medicationId;
  }

"""
    anchor = "  // ---------------------------------------------------------------------------\n  // GET /public-forms/:token\n"
    if anchor not in src:
        fail("could not find GET /public-forms anchor for helper insertion")
    src = src.replace(anchor, helper + anchor, 1)
    CTRL.write_text(src)
    print("[ok] patched public-form.controller.ts")
    return True

def main() -> None:
    changed = False
    changed |= patch_dto()
    changed |= patch_controller()
    if changed:
        print("[done] care reminder medication H5 submit fix applied. Restart apps/api before rerunning smoke.")
    else:
        print("[done] no changes needed.")

if __name__ == "__main__":
    main()
