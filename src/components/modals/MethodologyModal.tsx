import { useEffect, useState } from 'react';
import { BookOpen, Calculator, Layers, ListChecks, X } from 'lucide-react';
import { HAZARD_CATALOG } from '../../data/hazardCatalog';
import {
  CAPACITY_INDICATORS,
  EXPOSURE_INDICATORS,
  VULNERABILITY_INDICATORS,
} from '../../data/indicatorCatalog';
import {
  CAPACITY_LEVEL_STYLES,
  RISK_LEVEL_LIST,
  RISK_LEVEL_STYLES,
} from '../../data/riskPalette';
import { AGGREGATION_PROFILES } from '../../domain/districtRollup.ts';

interface MethodologyModalProps {
  open: boolean;
  onClose: () => void;
}

type ModalTab = 'guide' | 'formulas' | 'aggregation' | 'indicators';

export function MethodologyModal({ open, onClose }: MethodologyModalProps) {
  const [tab, setTab] = useState<ModalTab>('formulas');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="methodology-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 sm:p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 bg-[#0F294A] px-5 py-3.5 text-white">
          <div>
            <h2 id="methodology-modal-title" className="text-base font-bold">
              ระเบียบวิธีการคำนวณตามแผน ปภ. ชาติ พ.ศ. 2564-2570
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              กรอบสมการ H · E · V ÷ C → R • 10 สาธารณภัย • 13 ตัวชี้วัดย่อย • สเกล 1.00 - 5.00
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่างระเบียบวิธีการคำนวณ"
            className="rounded-lg p-1.5 text-slate-200 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-slate-200 bg-slate-50">
          {(
            [
              { id: 'formulas', label: '1. สูตรแผน ปภ. 64-70', icon: Calculator },
              { id: 'aggregation', label: '2. เฉลี่ยอำเภอสู่จังหวัด', icon: Layers },
              { id: 'indicators', label: '3. 13 ตัวชี้วัดย่อย', icon: ListChecks },
              { id: 'guide', label: '4. เกณฑ์สี 5 ระดับ', icon: BookOpen },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'border-[#0F294A] bg-white text-[#0F294A]'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs sm:text-sm text-slate-700 leading-relaxed">
          {tab === 'formulas' && (
            <>
              <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 text-xs text-blue-950">
                <strong>กรอบสมการแผนการป้องกันและบรรเทาสาธารณภัยแห่งชาติ พ.ศ. 2564-2570:</strong>
                <p className="mt-1">
                  ระดับความเสี่ยงสาธารณภัย (<strong>R</strong>) เพิ่มขึ้นจาก <strong>ภัยคุกคาม (H)</strong>,{' '}
                  <strong>ความล่อแหลม (E)</strong> และ <strong>ความเปราะบาง (V)</strong> และ{' '}
                  <strong>ลดลงจากศักยภาพในการจัดการความเสี่ยง (C)</strong> โดยแปลงให้อยู่บนสเกลสมมาตร{' '}
                  <strong>1.00 - 5.00</strong> ดังนี้:
                </p>
                <p className="mt-2 rounded-lg bg-white px-3 py-2 font-mono text-xs sm:text-sm font-bold text-[#0F294A] border border-blue-200 tabular-nums">
                  R_ddpm = H^0.40 × E^0.20 × V^0.20 × (6.00 - C)^0.20
                </p>
                <ul className="mt-2 list-disc pl-4 space-y-0.5">
                  <li>เมื่อ H = E = V = C = 3.00 จะได้ R = 3.00 พอดี (สมมาตรไร้ความเบ้)</li>
                  <li>เมื่อเพิ่มศักยภาพ C (เช่น ขยาย Cell Broadcast หรือการฝึกอบรม ปภ.) พจน์ (6 - C) จะลดลง ส่งผลให้ R ลดลงจริงทันที</li>
                  <li>
                    <strong>เกณฑ์นิรภัย (Safety Guardrail):</strong> หากภัยคุกคามสูงมาก H ≥ 4.60 ล็อกขั้นต่ำที่ 3.40 + 0.50(H - 4.60) (ระดับ 4 ขึ้นไป)
                    และหาก 3.80 ≤ H &lt; 4.60 ล็อกขั้นต่ำที่ 2.60 เพื่อไม่ให้ศักยภาพกลบภัยวิกฤตจนเกิดความประมาท
                  </li>
                </ul>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="rounded-xl border border-slate-200 p-3">
                  <h3 className="font-bold text-[#0F294A]">
                    การรวม 10 สาธารณภัยเป็นภัยคุกคามรวม (H_composite)
                  </h3>
                  <p className="mt-1">
                    ใช้สูตร Hybrid Max-Dominated Weighted Power Mean (p = 3, α = 0.55) ผสาน 55% ของภัยรุนแรงที่สุดกับ 45% ของค่าเฉลี่ยกำลัง 3
                    พร้อมโบนัสพหุภัยซ้อนทับ (+0.06 ต่อภัยตั้งแต่ 3.40 ขึ้นไป สูงสุด +0.24) และปรับสมดุลน้ำหนักอัตโนมัติใน 54 จังหวัดไร้ชายฝั่ง (ตัดสึนามิเป็น N/A)
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <h3 className="font-bold text-[#0F294A]">
                    3 โหมดการดูบนมิติความเสี่ยงสุทธิ (R)
                  </h3>
                  <ul className="mt-1 list-disc pl-4 space-y-1">
                    <li><strong>แผน ปภ. 64-70 (ค่าเริ่มต้น):</strong> คำนวณครบ 4 ปัจจัย H, E, V และหักลดด้วย C พร้อม Safety Guardrail</li>
                    <li><strong>ภัยสูงสุด (EOC):</strong> แสดงคะแนนภัยคุกคามสูงสุดโดยไม่หักลดด้วย C สำหรับศูนย์บัญชาการเหตุการณ์</li>
                    <li><strong>ก่อนหักศักยภาพ:</strong> คำนวณความเสี่ยงเบื้องต้นจาก H^0.50 × E^0.25 × V^0.25 เพื่อเปรียบเทียบผลลดความเสี่ยงจากศักยภาพพื้นที่</li>
                  </ul>
                </div>
              </div>

              <div>
                <h3 className="font-bold text-[#0F294A] mb-2">
                  ค่าน้ำหนัก 10 สาธารณภัยในปัจจัยภัยคุกคาม (H) — รวม = 1.00
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-xs">
                  {HAZARD_CATALOG.map((h) => (
                    <div key={h.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-center">
                      <p className="font-semibold text-slate-900 truncate">{h.shortNameTh}</p>
                      <p className="text-[11px] text-[#1D4ED8] font-bold tabular-nums">
                        {(h.weight * 100).toFixed(0)}%
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === 'aggregation' && (
            <div className="space-y-4 text-xs">
              <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 text-blue-950 space-y-1.5">
                <h3 className="font-bold text-[#0F294A]">
                  หลักการเลือกวิธีเฉลี่ยจาก 928 อำเภอ/เขต สู่ 77 จังหวัด ตามลักษณะข้อมูล
                </h3>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>
                    <strong>ภัยเฉพาะจุด (ดินถล่ม สารพิษ สึนามิ แผ่นดินไหว):</strong>{' '}
                    ให้น้ำหนักกลุ่มอำเภอเสี่ยงสูงสุดเพื่อไม่ให้พื้นที่ปลอดภัยกลบจุดวิกฤต
                  </li>
                  <li>
                    <strong>ทรัพยากรส่วนกลาง (ศูนย์ EOC เครื่องจักรกล การแพทย์ 1669):</strong>{' '}
                    ใช้ค่าเฉลี่ยถ่วงน้ำหนักรวมจังหวัดร่วมกับกลุ่มล่าง 20% เพราะสามารถเคลื่อนย้ายกำลังช่วยเหลือข้ามอำเภอได้
                  </li>
                  <li>
                    <strong>ความพร้อมเฉพาะถิ่น (Cell Broadcast การฝึกอบรม ปภ./อปพร.):</strong>{' '}
                    ใช้ค่าเฉลี่ยฮาร์มอนิกและกลุ่มล่าง 20% เพื่อตรวจจับอำเภอที่ควรเร่งเสริมความพร้อมและจัดสรรงบได้ตรงจุด
                  </li>
                </ol>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-amber-950 space-y-1">
                <h3 className="font-bold">
                  เหตุใดจึงไม่ใช้ค่าเฉลี่ยเลขคณิตธรรมดาหรือค่าเฉลี่ยแบบพิสัย (สูงสุด+ต่ำสุด)/2
                </h3>
                <ul className="list-disc pl-4 space-y-1">
                  <li>
                    <strong>กรณี 1 อำเภอวิกฤต 4.90 กับ 24 อำเภอปกติ 1.20:</strong>{' '}
                    ค่าเฉลี่ยธรรมดาจะได้เพียง 1.35 (สีน้ำเงิน) กลบอำเภอวิกฤตหายไป ส่วนค่าสูงสุดอย่างเดียว (4.90) ทำให้ทั้งจังหวัดเป็นสีแดงเกินจริง
                    สูตรสำหรับภัยเฉพาะจุดให้ค่า 2.80 (สีเหลือง) พร้อมแสดงป้ายแจ้งจุดเฝ้าระวังเฉพาะอำเภอ
                  </li>
                  <li>
                    <strong>กรณี 20 อำเภอวิกฤต 4.50 กับ 1 อำเภอปกติ 1.00:</strong>{' '}
                    ค่าเฉลี่ยแบบพิสัยจะได้ (4.50+1.00)/2 = 2.75 (สีเหลือง) ทั้งที่เกือบทั้งจังหวัดอยู่ในระดับวิกฤต
                    ขณะที่สูตร Power Mean ผสมกลุ่มบน 20% (Weighted CVaR) ให้ค่า 4.46 (สีแดง) สอดคล้องกับภาพรวมพื้นที่
                    และคงคุณสมบัติค่าเพิ่มขึ้นตามระดับความเสี่ยงเสมอ (Monotonic)
                  </li>
                </ul>
              </div>

              <div className="space-y-2">
                <h3 className="font-bold text-[#0F294A]">
                  สรุป 6 กลุ่มหลัก (7 รูปแบบการรวมคะแนนระดับอำเภอสู่จังหวัด)
                </h3>
                <div className="space-y-2">
                  {AGGREGATION_PROFILES.map((pf) => (
                    <div
                      key={pf.id}
                      className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-1"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold text-[#0F294A]">
                          {pf.id}: {pf.nameTh}
                        </span>
                        <span className="rounded bg-white border border-slate-200 px-2 py-0.5 font-mono text-[11px] font-semibold text-[#1D4ED8] tabular-nums">
                          {pf.formulaSummaryTh}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-700">
                        <strong>ครอบคลุม:</strong> {pf.membersTh}
                      </p>
                      <p className="text-[11px] text-slate-600">
                        <strong>ลักษณะข้อมูลและน้ำหนัก:</strong> {pf.distributionTh} | {pf.weightBasisTh}
                      </p>
                      <p className="text-[11px] text-slate-600">{pf.rationaleTh}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'indicators' && (
            <div className="space-y-4 text-xs">
              <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-3.5">
                <h3 className="font-bold text-[#115E59] mb-2">
                  ศักยภาพในการจัดการความเสี่ยง (C) — 5 ตัวชี้วัดย่อย (รวม 100% | ยิ่งสูงยิ่งลดความเสี่ยง)
                </h3>
                <div className="space-y-2">
                  {CAPACITY_INDICATORS.map((ind) => (
                    <div key={ind.id} className="rounded-lg bg-white p-2.5 border border-teal-100">
                      <div className="flex justify-between gap-2 font-semibold text-slate-900">
                        <span>{ind.nameTh}</span>
                        <span className="shrink-0 text-[#0F766E] tabular-nums">
                          {(ind.weight * 100).toFixed(0)}%
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-0.5">{ind.descriptionTh}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        หน่วยงานอ้างอิง: {ind.agencySourceTh}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <h3 className="font-bold text-[#0F294A] mb-2">
                  ความล่อแหลม (E) — 4 ตัวชี้วัดย่อย (รวม 100% | ยิ่งสูงยิ่งเพิ่มความเสี่ยง)
                </h3>
                <div className="space-y-1.5">
                  {EXPOSURE_INDICATORS.map((ind) => (
                    <div key={ind.id} className="rounded-lg bg-white p-2 border border-slate-200">
                      <div className="flex justify-between gap-2 font-semibold text-slate-900">
                        <span>{ind.nameTh}</span>
                        <span className="shrink-0 text-[#1D4ED8] tabular-nums">
                          {(ind.weight * 100).toFixed(0)}%
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-0.5">{ind.descriptionTh}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <h3 className="font-bold text-[#0F294A] mb-2">
                  ความเปราะบาง (V) — 4 ตัวชี้วัดย่อย (รวม 100% | ยิ่งสูงยิ่งเพิ่มความเสี่ยง)
                </h3>
                <div className="space-y-1.5">
                  {VULNERABILITY_INDICATORS.map((ind) => (
                    <div key={ind.id} className="rounded-lg bg-white p-2 border border-slate-200">
                      <div className="flex justify-between gap-2 font-semibold text-slate-900">
                        <span>{ind.nameTh}</span>
                        <span className="shrink-0 text-[#1D4ED8] tabular-nums">
                          {(ind.weight * 100).toFixed(0)}%
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-0.5">{ind.descriptionTh}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'guide' && (
            <div className="space-y-4 text-xs">
              <div>
                <h3 className="font-bold text-[#0F294A] mb-2">
                  ชุดสีความเสี่ยง 5 ระดับ (สำหรับ R, H, E, V — น้ำเงิน → เขียว → เหลือง → ส้ม → แดง)
                </h3>
                <div className="space-y-1.5">
                  {RISK_LEVEL_LIST.map((lvl) => {
                    const st = RISK_LEVEL_STYLES[lvl];
                    return (
                      <div
                        key={lvl}
                        className="flex items-center gap-2.5 rounded-xl border p-2.5"
                        style={{ backgroundColor: st.tintBg, borderColor: st.tintBorder }}
                      >
                        <span
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold"
                          style={{ backgroundColor: st.badgeBg, color: st.badgeText }}
                        >
                          {st.symbol}
                        </span>
                        <div>
                          <p className="font-bold text-slate-900 tabular-nums">
                            ระดับ {lvl}: {st.labelTh} ({st.rangeLabel})
                          </p>
                          <p className="text-[11px] text-slate-700">{st.actionToneTh}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <h3 className="font-bold text-[#115E59] mb-2">
                  ชุดสีเฉพาะโทนมรกต 5 เฉด สำหรับมิติศักยภาพ (C — อ่อน → เข้ม ยิ่งเข้มยิ่งพร้อมสูง)
                </h3>
                <div className="space-y-1.5">
                  {RISK_LEVEL_LIST.map((lvl) => {
                    const st = CAPACITY_LEVEL_STYLES[lvl];
                    return (
                      <div
                        key={lvl}
                        className="flex items-center gap-2.5 rounded-xl border p-2.5"
                        style={{ backgroundColor: st.tintBg, borderColor: st.tintBorder }}
                      >
                        <span
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold ring-1 ring-slate-900/10"
                          style={{
                            backgroundColor: st.mapFill,
                            color: lvl <= 3 ? '#0F172A' : '#FFFFFF',
                          }}
                        >
                          {st.symbol}
                        </span>
                        <div>
                          <p className="font-bold text-slate-900 tabular-nums">
                            ระดับ {lvl}: {st.labelTh} ({st.rangeLabel})
                          </p>
                          <p className="text-[11px] text-slate-700">{st.actionToneTh}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
