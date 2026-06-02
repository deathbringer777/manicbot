/**
 * masterSchedulePolicy — pure helpers for the salon-level master-schedule
 * governance setting stored in the tenants.salon JSON blob.
 */
import { describe, it, expect } from "vitest";
import {
  MASTER_SCHEDULE_POLICIES,
  DEFAULT_MASTER_SCHEDULE_POLICY,
  isMasterSchedulePolicy,
  readMasterSchedulePolicy,
} from "~/lib/masterSchedulePolicy";

describe("masterSchedulePolicy helpers", () => {
  it("exposes exactly the three policy modes with master_free as the default", () => {
    expect(MASTER_SCHEDULE_POLICIES).toEqual(["salon_only", "master_free", "master_approval"]);
    expect(DEFAULT_MASTER_SCHEDULE_POLICY).toBe("master_free");
  });

  it("isMasterSchedulePolicy accepts valid modes and rejects anything else", () => {
    expect(isMasterSchedulePolicy("salon_only")).toBe(true);
    expect(isMasterSchedulePolicy("master_approval")).toBe(true);
    expect(isMasterSchedulePolicy("nope")).toBe(false);
    expect(isMasterSchedulePolicy(null)).toBe(false);
    expect(isMasterSchedulePolicy(undefined)).toBe(false);
    expect(isMasterSchedulePolicy(3)).toBe(false);
  });

  it("readMasterSchedulePolicy parses the key out of a tenants.salon JSON string", () => {
    expect(readMasterSchedulePolicy('{"masterSchedulePolicy":"salon_only"}')).toBe("salon_only");
    expect(readMasterSchedulePolicy('{"masterSchedulePolicy":"master_approval","name":"X"}')).toBe(
      "master_approval",
    );
  });

  it("readMasterSchedulePolicy defaults to master_free for null / empty / malformed / missing", () => {
    expect(readMasterSchedulePolicy(null)).toBe("master_free");
    expect(readMasterSchedulePolicy(undefined)).toBe("master_free");
    expect(readMasterSchedulePolicy("")).toBe("master_free");
    expect(readMasterSchedulePolicy("not json")).toBe("master_free");
    expect(readMasterSchedulePolicy('{"name":"Salon with no policy"}')).toBe("master_free");
    expect(readMasterSchedulePolicy('{"masterSchedulePolicy":"bogus"}')).toBe("master_free");
  });
});
