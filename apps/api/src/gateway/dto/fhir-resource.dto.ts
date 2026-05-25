/**
 * fhir-resource.dto.ts
 *
 * 接收 FHIR R4 资源时的"宽松"DTO。
 *
 * FHIR 标准本身极其复杂（光 Patient 资源 schema 就上百个字段），
 * 我们不可能也不需要在 DTO 层做完整的 schema 校验。
 *
 * 这里只用 class-validator 校验最关键的几个字段（resourceType 必须存在），
 * 其余字段以 Record<string, unknown> 传入，由 fhir-resource.mapper.ts 安全地取值。
 *
 * 这样的好处：
 *   1. 医院 IT 推过来的 FHIR 资源即使带了我们没声明的扩展字段，请求也不会被拒
 *   2. 后续要支持新的 FHIR 资源类型，只改 mapper 不用动 DTO
 */

import { IsObject, IsOptional, IsString } from 'class-validator';

/**
 * 单个 FHIR 资源（用于 POST /gateway/fhir/<ResourceType>）。
 */
export class FhirResourceDto {
  @IsString()
  resourceType!: string;

  @IsOptional()
  @IsString()
  id?: string;

  /**
   * 索引签名 — 允许任意其他 FHIR 字段。
   * NestJS 的 ValidationPipe 在 whitelist=true 时默认会剥掉未声明字段，
   * 因此在 main.ts 中需要 `whitelist: true, forbidNonWhitelisted: false`（项目当前配置已满足）。
   *
   * 但是 ValidationPipe 即便不剥，也会丢弃没标注的字段。所以我们用一个
   * 显式的"载荷"字段把整个 FHIR 资源原样收下：
   */
  // 索引签名只是给 TS 用，运行时不会被校验
  [key: string]: unknown;
}

/**
 * FHIR Bundle（事务包），用于 POST /gateway/fhir/Bundle
 * 形如 { resourceType: "Bundle", type: "transaction", entry: [...] }
 */
export class FhirBundleDto {
  @IsString()
  resourceType!: string; // 必须等于 "Bundle"

  @IsOptional()
  @IsString()
  type?: string; // transaction / batch / collection / ...

  @IsOptional()
  entry?: Array<{ resource?: Record<string, unknown>; fullUrl?: string }>;

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}
