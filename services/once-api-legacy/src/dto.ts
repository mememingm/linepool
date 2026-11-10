import { IsEmail, IsIn, IsString, MaxLength, MinLength, IsOptional, IsInt, Min, Max, IsUUID, IsISO8601, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import type { MockScenario } from './fulfillment.service';

export class CredentialsDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
}
export class ForgotPasswordDto {
  @IsEmail() @MaxLength(254) email!: string;
}
export class ResetPasswordDto {
  @IsString() @MinLength(32) @MaxLength(128) @Matches(/^[a-f0-9]+$/) token!: string;
  @IsString() @MinLength(12) @MaxLength(128) newPassword!: string;
}
export class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(128) currentPassword!: string;
  @IsString() @MinLength(12) @MaxLength(128) newPassword!: string;
}
export class RenewDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(365) term!: number;
  @Type(() => Number) @IsInt() @Min(1) quoteVersion!: number;
  @IsOptional() @IsUUID() purchaseIntentId?: string;
}
export class RentDto extends RenewDto {
  @IsString() @MaxLength(40) number!: string;
}
export class SendSmsDto {
  @IsString() @MaxLength(32) @Matches(/^\+[1-9][0-9 ()-]{1,30}$/) to!: string;
  @IsString() @MinLength(1) @MaxLength(4000) @Matches(/\S/) content!: string;
}
export class HistoryQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit: number = 100;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(1024) cursor?: string;
}
export class OrderHistoryQuery extends HistoryQuery {
  @IsOptional() @IsUUID() leaseId?: string;
}
export class MockOrderDto extends RentDto {
  @IsIn(['SUCCESS','FAILURE','UNKNOWN_SUCCESS','UNKNOWN_FAILURE']) scenario!: MockScenario;
}
export class MockEventDto {
  @IsString() @MinLength(1) @MaxLength(128) @Matches(/^[A-Za-z0-9_-]+$/) eventId!: string;
  @IsUUID() leaseId!: string;
  @IsString() @MinLength(1) @MaxLength(128) providerMessageId!: string;
  @IsString() @MinLength(1) @MaxLength(120) sender!: string;
  @IsString() @MaxLength(200) title!: string;
  @IsString() @MaxLength(12000) body!: string;
  @IsOptional() @IsString() @MaxLength(64) code?: string;
  @IsISO8601({ strict: true }) @Matches(/(?:Z|[+-]\d{2}:\d{2})$/) receivedAt!: string;
}
