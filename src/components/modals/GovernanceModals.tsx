import { useEffect, useState } from 'react';
import { CheckCircle2, FileClock, Flag, X } from 'lucide-react';
import { MODEL_VERSION } from '../../domain/csvExporter';

interface ChangelogModalProps {
  open: boolean;
  onClose: () => void;
}

export function ChangelogModal({ open, onClose }: ChangelogModalProps) {
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
      aria-labelledby="changelog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-[#0F294A] px-5 py-3.5 text-white">
          <h2 id="changelog-title" className="flex items-center gap-2 text-sm sm:text-base font-bold">
            <FileClock className="h-4 w-4 text-amber-300" aria-hidden="true" />
            ประวัติการปรับปรุงชุดข้อมูลและแบบจำลอง (Data Changelog)
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่างประวัติการปรับปรุง"
            className="rounded-lg p-1 text-slate-200 hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-3 text-xs sm:text-sm text-slate-700 leading-relaxed">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#0F294A] tabular-nums">รุ่น {MODEL_VERSION}</span>
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-900 tabular-nums">
                26 พฤศจิกายน 2569
              </span>
            </div>
            <ul className="mt-2 list-disc pl-5 space-y-1 text-xs">
              <li>เพิ่ม<strong>ฐานข้อมูลรายช่วงเวลา (928 อำเภอ/เขต ใน 77 จังหวัด)</strong> รองรับการบันทึก ปรับปรุง และเรียกดูแนวโน้มความเสี่ยงย้อนหลังหลายไตรมาสโดยไม่เขียนทับประวัติเดิม</li>
              <li>เพิ่ม<strong>พอร์ทัลเจ้าหน้าที่ ปภ. พร้อมความปลอดภัยไซเบอร์ภาครัฐ</strong> (ยืนยันตัวตน 2 ชั้น, จำกัดสิทธิ์แก้ไขเฉพาะอำเภอในจังหวัดที่สังกัด, ขั้นตอนจังหวัดตรวจอนุมัติ, ป้องกัน CSRF/Brute-Force/IDOR และบันทึกตรวจสอบย้อนหลังแบบสายโซ่แฮช SHA-256)</li>
              <li>ยึดกรอบ<strong>แผน ปภ. แห่งชาติ พ.ศ. 2564-2570</strong>: ความเสี่ยงสุทธิ R = H^0.40 × E^0.20 × V^0.20 × (6 - C)^0.20 พร้อม 13 ตัวชี้วัดย่อย (รวม Cell Broadcast และการฝึกอบรม ปภ./อปพร.) และเกณฑ์เฝ้าระวังขั้นต่ำ</li>
              <li>ชุดสี 5 ระดับความเสี่ยง (น้ำเงิน–แดง) และชุดสีมรกต 5 เฉดสำหรับศักยภาพ ผ่านเกณฑ์ WCAG 2.1 AA และหน้าประชาชนปลอดคุกกี้ติดตาม (PDPA)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ReportDiscrepancyModalProps {
  open: boolean;
  initialProvinceName?: string;
  onClose: () => void;
}

export function ReportDiscrepancyModal({
  open,
  initialProvinceName,
  onClose,
}: ReportDiscrepancyModalProps) {
  const [provinceText, setProvinceText] = useState(initialProvinceName ?? '');
  const [category, setCategory] = useState('ข้อมูลระดับความเสี่ยงรายภัย');
  const [details, setDetails] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    setProvinceText(initialProvinceName ?? '');
    setSubmitted(false);
    setDetails('');
  }, [initialProvinceName, open]);

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
      aria-labelledby="report-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-[#0F294A] px-5 py-3.5 text-white">
          <h2 id="report-modal-title" className="flex items-center gap-2 text-sm sm:text-base font-bold">
            <Flag className="h-4 w-4 text-amber-300" aria-hidden="true" />
            แจ้งข้อมูลคลาดเคลื่อนหรือข้อเสนอแนะ
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่างแจ้งข้อมูลคลาดเคลื่อน"
            className="rounded-lg p-1 text-slate-200 hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5">
          {submitted ? (
            <div className="py-4 text-center space-y-3">
              <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" aria-hidden="true" />
              <h3 className="text-base font-bold text-[#0F294A]">
                บันทึกร่างข้อเสนอแนะเรียบร้อยแล้ว (โหมดสาธิต Zero-Tracking)
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                ในระบบสาธิตนี้ไม่มีการส่งข้อมูลส่วนบุคคลออกไปยังเซิร์ฟเวอร์ภายนอก (ตามนโยบาย PDPA Zero-Tracking)
                สำหรับเวอร์ชันใช้งานจริงของหน่วยงาน จะเข้าสู่รอบตรวจสอบตาม SLA ภายใน 2 วันทำการ
              </p>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-[#0F294A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#163A66]"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSubmitted(true);
              }}
              className="space-y-3 text-xs"
            >
              <p className="rounded-lg bg-slate-50 p-2.5 text-slate-600 leading-relaxed">
                ระบบไม่เก็บข้อมูลส่วนบุคคล (ไม่ต้องกรอกชื่อ เลขบัตรประชาชน หรือเบอร์โทรศัพท์)
                หากต้องการแจ้งเหตุสาธารณภัยฉุกเฉินโปรดโทร <strong>1784</strong> ตลอด 24 ชั่วโมง
              </p>

              <div>
                <label htmlFor="report-province" className="block font-semibold text-slate-700 mb-1">
                  จังหวัดที่เกี่ยวข้อง
                </label>
                <input
                  id="report-province"
                  type="text"
                  required
                  value={provinceText}
                  onChange={(e) => setProvinceText(e.target.value)}
                  placeholder="ระบุชื่อจังหวัด เช่น เชียงใหม่, กรุงเทพมหานคร"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                />
              </div>

              <div>
                <label htmlFor="report-category" className="block font-semibold text-slate-700 mb-1">
                  หัวข้อที่ต้องการเสนอแนะ
                </label>
                <select
                  id="report-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                >
                  <option>ข้อมูลระดับความเสี่ยงรายภัย</option>
                  <option>ขอบเขตพื้นที่หรือชื่อจังหวัดบนแผนที่</option>
                  <option>คำแนะนำการปฏิบัติตนและหมายเลขสายด่วน</option>
                  <option>ข้อเสนอแนะด้านการใช้งานเว็บไซต์ (UX/UI)</option>
                </select>
              </div>

              <div>
                <label htmlFor="report-details" className="block font-semibold text-slate-700 mb-1">
                  รายละเอียดเพิ่มเติม
                </label>
                <textarea
                  id="report-details"
                  required
                  rows={3}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="ระบุประเด็นที่พบหรือแหล่งข้อมูลอ้างอิงเพื่อประกอบการปรับปรุง..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[#0F294A] px-4 py-2 font-semibold text-white hover:bg-[#163A66]"
                >
                  ส่งข้อเสนอแนะ
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
