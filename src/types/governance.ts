import type {
  CapacityIndicatorId,
  ExposureIndicatorId,
  HazardId,
  ProvinceRiskRecord,
  RiskLevel,
  VulnerabilityIndicatorId,
} from './risk.ts';

export type UserRole = 'district_officer' | 'province_reviewer' | 'ddpm_central_admin';

export type DistrictGeoClass = 'metro' | 'coastal' | 'mountain' | 'river_basin' | 'rural';

export interface DistrictMeta {
  readonly code: string; // รหัสอำเภอ 4 หลัก มท. เช่น "5001", "1001"
  readonly provinceCode: string; // รหัสจังหวัด 2 หลัก เช่น "50", "10"
  readonly prefixTh: string; // "อำเภอ" หรือ "เขต"
  readonly nameTh: string; // ชื่อเฉพาะ เช่น "เมืองเชียงใหม่", "พระนคร"
  readonly fullNameTh: string; // ชื่อเต็ม เช่น "อำเภอเมืองเชียงใหม่", "เขตพระนคร"
  readonly nameEn: string;
  readonly geoClass: DistrictGeoClass;
  readonly popWeight: number;
}

export interface DistrictMetricsPayload {
  readonly hazards: Record<HazardId, number | null>;
  readonly exposureIndicators: Record<ExposureIndicatorId, number>;
  readonly vulnerabilityIndicators: Record<VulnerabilityIndicatorId, number>;
  readonly capacityIndicators: Record<CapacityIndicatorId, number>;
}

export interface ReportingPeriod {
  readonly periodId: string; // เช่น "2569-Q3"
  readonly labelTh: string; // เช่น "ไตรมาส 3/2569"
  readonly effectiveFrom: string; // YYYY-MM-DD (ค.ศ. ในระบบข้อมูล)
  readonly effectiveTo: string | null;
  readonly status: 'open' | 'locked';
  readonly isCurrent: boolean;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface DistrictEvaluation {
  readonly district: DistrictMeta;
  readonly periodId: string;
  readonly version: number;
  readonly metrics: DistrictMetricsPayload;
  readonly hazardCompositeScore: number;
  readonly exposureScore: number;
  readonly vulnerabilityScore: number;
  readonly capacityScore: number;
  readonly ddpmScore: number;
  readonly ddpmLevel: RiskLevel;
  readonly dominantHazardId: HazardId;
  readonly previousDdpmScore: number | null;
  readonly deltaFromPrevious: number | null;
  readonly updatedBy: string;
  readonly updatedAt: string;
}

export interface ProvinceTrendPoint {
  readonly periodId: string;
  readonly labelTh: string;
  readonly ddpmScore: number;
  readonly ddpmLevel: RiskLevel;
  readonly hazardScore: number;
  readonly exposureScore: number;
  readonly vulnerabilityScore: number;
  readonly capacityScore: number;
}

export interface PeriodProvincesResponse {
  readonly period: ReportingPeriod;
  readonly provinces: readonly ProvinceRiskRecord[];
  readonly lastUpdatedAt: string;
  readonly dataSource: 'database' | 'fallback';
}

export interface ProvinceDistrictsResponse {
  readonly period: ReportingPeriod;
  readonly provinceCode: string;
  readonly provinceNameTh: string;
  readonly districts: readonly DistrictEvaluation[];
}

export interface AuthUser {
  readonly id: string;
  readonly username: string;
  readonly displayNameTh: string;
  readonly positionTh: string;
  readonly role: UserRole;
  readonly provinceCode: string | null;
  readonly provinceNameTh: string | null;
  readonly districtCode: string | null;
  readonly districtNameTh: string | null;
}

export interface MetricDiffItem {
  readonly group: 'H' | 'E' | 'V' | 'C';
  readonly key: string;
  readonly labelTh: string;
  readonly before: number | null;
  readonly after: number | null;
  readonly delta: number;
}

export interface ChangeRequestRecord {
  readonly id: number;
  readonly periodId: string;
  readonly periodLabelTh: string;
  readonly provinceCode: string;
  readonly provinceNameTh: string;
  readonly districtCode: string;
  readonly districtNameTh: string;
  readonly submittedByUserId: string;
  readonly submittedByName: string;
  readonly submittedAt: string;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly reasonTh: string;
  readonly referenceDoc: string;
  readonly beforeMetrics: DistrictMetricsPayload;
  readonly afterMetrics: DistrictMetricsPayload;
  readonly diffItems: readonly MetricDiffItem[];
  readonly beforeDdpmScore: number;
  readonly afterDdpmScore: number;
  readonly reviewedByName: string | null;
  readonly reviewedAt: string | null;
  readonly reviewNoteTh: string | null;
}

export type AuditEventType =
  | 'SYSTEM_GENESIS'
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGIN_LOCKED'
  | 'TOTP_FAILED'
  | 'LOGOUT'
  | 'DISTRICT_DRAFT_SUBMITTED'
  | 'DISTRICT_CHANGE_APPROVED'
  | 'DISTRICT_CHANGE_REJECTED'
  | 'PERIOD_CREATED'
  | 'PERIOD_STATUS_UPDATED'
  | 'UNAUTHORIZED_SCOPE_ATTEMPT'
  | 'CSRF_REJECTED';

export interface AuditLogEntry {
  readonly seq: number;
  readonly createdAt: string;
  readonly eventType: AuditEventType;
  readonly actorUserId: string | null;
  readonly actorUsername: string | null;
  readonly actorRole: UserRole | null;
  readonly targetProvinceCode: string | null;
  readonly targetDistrictCode: string | null;
  readonly periodId: string | null;
  readonly ipAddress: string | null;
  readonly summaryTh: string;
  readonly details: Record<string, unknown>;
  readonly prevHash: string;
  readonly entryHash: string;
}

export interface AuditChainVerification {
  readonly valid: boolean;
  readonly totalEntries: number;
  readonly brokenAtSeq: number | null;
  readonly latestHash: string;
  readonly verifiedAt: string;
}

export interface DemoAccountInfo {
  readonly username: string;
  readonly displayNameTh: string;
  readonly positionTh: string;
  readonly role: UserRole;
  readonly scopeLabelTh: string;
  readonly provinceCode: string | null;
  readonly districtCode: string | null;
}
