import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type {
  FeatureFlag,
  FeatureFlagMode,
  FeatureFlagsRepositoryContract,
  FeatureSubject,
  FeatureTester,
  FeatureTesterSubjectType
} from './feature-flags.types.js';

@Injectable()
export class FeatureFlagsRepository implements FeatureFlagsRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listFlags(): Promise<FeatureFlag[]> {
    const result = await sql<FeatureFlag>`
      select key, mode, description, updated_at::text as "updatedAt"
      from public.feature_flags
      order by key
    `.execute(this.database.db);
    return result.rows;
  }

  async findFlag(key: string): Promise<FeatureFlag | undefined> {
    const result = await sql<FeatureFlag>`
      select key, mode, description, updated_at::text as "updatedAt"
      from public.feature_flags
      where key = ${key}
    `.execute(this.database.db);
    return result.rows[0];
  }

  async updateFlagMode(
    key: string,
    mode: FeatureFlagMode,
    actorUserId: string
  ): Promise<FeatureFlag | undefined> {
    const result = await sql<FeatureFlag>`
      update public.feature_flags
      set mode = ${mode}, updated_by = ${actorUserId}::uuid
      where key = ${key}
      returning key, mode, description, updated_at::text as "updatedAt"
    `.execute(this.database.db);
    return result.rows[0];
  }

  async isTester(subject: FeatureSubject): Promise<boolean> {
    const result = await sql<{ isTester: boolean }>`
      select exists (
        select 1 from public.feature_testers t
        where (t.subject_type = 'user' and t.subject_id = ${subject.userId ?? null}::uuid)
           or (t.subject_type = 'vendor' and t.subject_id = ${subject.vendorId ?? null}::uuid)
      ) as "isTester"
    `.execute(this.database.db);
    return result.rows[0]?.isTester ?? false;
  }

  async listTesters(): Promise<FeatureTester[]> {
    const result = await sql<FeatureTester>`
      select
        id::text as "id",
        subject_type as "subjectType",
        subject_id::text as "subjectId",
        note,
        created_at::text as "createdAt"
      from public.feature_testers
      order by created_at desc
    `.execute(this.database.db);
    return result.rows;
  }

  async addTester(
    subjectType: FeatureTesterSubjectType,
    subjectId: string,
    note: string | null,
    actorUserId: string
  ): Promise<FeatureTester> {
    const result = await sql<FeatureTester>`
      insert into public.feature_testers (subject_type, subject_id, note, created_by)
      values (${subjectType}, ${subjectId}::uuid, ${note}, ${actorUserId}::uuid)
      on conflict (subject_type, subject_id) do update set note = excluded.note
      returning
        id::text as "id",
        subject_type as "subjectType",
        subject_id::text as "subjectId",
        note,
        created_at::text as "createdAt"
    `.execute(this.database.db);
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('Feature tester insert did not return a row.');
    }
    return row;
  }

  async removeTester(testerId: string): Promise<FeatureTester | undefined> {
    const result = await sql<FeatureTester>`
      delete from public.feature_testers
      where id = ${testerId}::uuid
      returning
        id::text as "id",
        subject_type as "subjectType",
        subject_id::text as "subjectId",
        note,
        created_at::text as "createdAt"
    `.execute(this.database.db);
    return result.rows[0];
  }

  async subjectExists(subjectType: FeatureTesterSubjectType, subjectId: string): Promise<boolean> {
    const result =
      subjectType === 'vendor'
        ? await sql<{ found: boolean }>`
            select exists (select 1 from public.vendors where id = ${subjectId}::uuid) as "found"
          `.execute(this.database.db)
        : await sql<{ found: boolean }>`
            select exists (select 1 from public.profiles where id = ${subjectId}::uuid) as "found"
          `.execute(this.database.db);
    return result.rows[0]?.found ?? false;
  }
}
