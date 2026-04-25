import { describe, it, expect } from "vitest"
import {
  parseFmasianRecord,
  parseSkillCourseRecord,
  extractConvocationPlace,
} from "../airtable-parser"

describe("parseFmasianRecord", () => {
  it("parses a complete FMASIAN record", () => {
    const raw = {
      id: "rec00XD9caopba2tD",
      fields: {
        Name: "Varsha Saboo",
        "AMASI Number": "9169",
        "YEAR OF CONVOCATION copy": "2019",
        "Skill Course Details": ["recga0FTGLyZDigYd"],
      },
    }
    expect(parseFmasianRecord(raw)).toEqual({
      id: "rec00XD9caopba2tD",
      name: "Varsha Saboo",
      amasiNumber: 9169,
      yearOfConvocation: 2019,
      skillCourseRecordId: "recga0FTGLyZDigYd",
    })
  })

  it("returns amasiNumber: null when AMASI Number is missing", () => {
    const raw = {
      id: "rec1",
      fields: { Name: "Foo", "YEAR OF CONVOCATION copy": "2020" },
    }
    expect(parseFmasianRecord(raw).amasiNumber).toBeNull()
  })

  it("returns yearOfConvocation: null when missing", () => {
    const raw = { id: "rec1", fields: { Name: "Foo", "AMASI Number": "100" } }
    expect(parseFmasianRecord(raw).yearOfConvocation).toBeNull()
  })

  it("coerces a numeric AMASI Number to int", () => {
    const raw = { id: "rec1", fields: { Name: "Foo", "AMASI Number": 8054 } }
    expect(parseFmasianRecord(raw).amasiNumber).toBe(8054)
  })

  it("returns skillCourseRecordId: null when no linked record", () => {
    const raw = { id: "rec1", fields: { Name: "Foo" } }
    expect(parseFmasianRecord(raw).skillCourseRecordId).toBeNull()
  })
})

describe("parseSkillCourseRecord", () => {
  it("parses a complete Skill Course record", () => {
    const raw = {
      id: "recga0FTGLyZDigYd",
      fields: {
        "Skill course Number": 62,
        "Year of FMAS": "2019",
        "President Details": "Suresh Chandra Hari",
        "Convocation Date and Place": "5th Nov 2015-Mumbai",
        "FMAS Certificate": [
          {
            id: "att1",
            url: "https://airtable.example/cert.jpg",
            filename: "FMAS 2019.jpg",
          },
        ],
      },
    }
    expect(parseSkillCourseRecord(raw)).toEqual({
      id: "recga0FTGLyZDigYd",
      skillCourseNumber: 62,
      yearOfFmas: 2019,
      presidentName: "Suresh Chandra Hari",
      convocationDateAndPlace: "5th Nov 2015-Mumbai",
      fmasCertificateAttachmentUrl: "https://airtable.example/cert.jpg",
      fmasCertificateFilename: "FMAS 2019.jpg",
    })
  })

  it("returns null attachment fields when no FMAS Certificate present", () => {
    const raw = {
      id: "rec1",
      fields: { "Skill course Number": 1, "Year of FMAS": "2010" },
    }
    const parsed = parseSkillCourseRecord(raw)
    expect(parsed.fmasCertificateAttachmentUrl).toBeNull()
    expect(parsed.fmasCertificateFilename).toBeNull()
  })

  it("coerces yearOfFmas as int", () => {
    const raw = {
      id: "rec1",
      fields: { "Skill course Number": 1, "Year of FMAS": 2018 },
    }
    expect(parseSkillCourseRecord(raw).yearOfFmas).toBe(2018)
  })
})

describe("extractConvocationPlace", () => {
  it("extracts place from 'Nov 5 2015-Mumbai'", () => {
    expect(extractConvocationPlace("5th Nov 2015-Mumbai")).toBe("Mumbai")
  })

  it("extracts place from '02nd November 2023 Raipur'", () => {
    expect(extractConvocationPlace("02nd November 2023 Raipur")).toBe("Raipur")
  })

  it("returns null when input is null", () => {
    expect(extractConvocationPlace(null)).toBeNull()
  })

  it("returns the whole string if no clear place delimiter", () => {
    expect(extractConvocationPlace("TBD")).toBe("TBD")
  })
})
