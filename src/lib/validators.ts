import type { ApplicationFormData, OCRVerification } from "./membership-types"
import { getMembershipType } from "./membership-types"

export function validatePersonalDetails(data: ApplicationFormData): Record<string, string> {
  const errors: Record<string, string> = {}

  if (!data.firstName.trim()) errors.firstName = "Enter your first name as on MCI certificate"
  else if (data.firstName.trim().length < 2) errors.firstName = "Name must be at least 2 characters"
  if (!data.dob) errors.dob = "Select your date of birth"
  if (!data.gender) errors.gender = "Select Male, Female, or Other"
  if (!data.email.trim()) errors.email = "Enter your email address"
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.email = "Enter a valid email (e.g. doctor@gmail.com)"
  if (!data.mobile.trim()) errors.mobile = "Enter your 10-digit mobile number"
  else if (!/^\d{10}$/.test(data.mobile)) errors.mobile = "Mobile must be exactly 10 digits (no +91)"
  if (data.pin.trim() && !/^\d{6}$/.test(data.pin)) errors.pin = "PIN must be exactly 6 digits"

  return errors
}

export function validateEducation(data: ApplicationFormData): Record<string, string> {
  const errors: Record<string, string> = {}
  const type = getMembershipType(data.membershipType)
  if (!type) return errors

  if (type.requiresPG) {
    if (!data.eduPostgradDegree.trim()) errors.eduPostgradDegree = "Select your PG degree (e.g. MS General Surgery)"
    if (!data.eduPostgradCollege.trim()) errors.eduPostgradCollege = "Enter your PG college name"
    else if (data.eduPostgradCollege.trim().length < 3) errors.eduPostgradCollege = "College name must be at least 3 characters"
    if (!data.eduPostgradUniversity.trim()) errors.eduPostgradUniversity = "Enter the university name"
    else if (data.eduPostgradUniversity.trim().length < 3) errors.eduPostgradUniversity = "University name must be at least 3 characters"
    if (!data.eduPostgradYear) errors.eduPostgradYear = "Select your PG completion year"
  }

  if (type.requiresMBBS) {
    if (!data.eduUndergradCollege.trim()) errors.eduUndergradCollege = "Enter your MBBS college name"
    else if (data.eduUndergradCollege.trim().length < 3) errors.eduUndergradCollege = "College name must be at least 3 characters"
    if (!data.eduUndergradUniversity.trim()) errors.eduUndergradUniversity = "Enter the university name"
    else if (data.eduUndergradUniversity.trim().length < 3) errors.eduUndergradUniversity = "University name must be at least 3 characters"
    if (!data.eduUndergradYear) errors.eduUndergradYear = "Select your MBBS completion year"
  }

  return errors
}

export function validateRegistration(data: ApplicationFormData): Record<string, string> {
  const errors: Record<string, string> = {}
  const type = getMembershipType(data.membershipType)
  if (!type) return errors

  if (type.id !== "ILM") {
    if (!data.mciCouncilNumber.trim()) errors.mciCouncilNumber = "Enter your MCI/State Medical Council registration number"
    if (!data.mciCouncilState) errors.mciCouncilState = "Select the state of your medical council"
  }

  if (type.requiresASI) {
    if (!data.asiMembershipNo.trim()) errors.asiMembershipNo = "Enter your ASI life membership number"
  }

  return errors
}

export function validateDocuments(data: ApplicationFormData): Record<string, string> {
  const errors: Record<string, string> = {}
  const type = getMembershipType(data.membershipType)
  if (!type) return errors

  for (const doc of type.requiredDocs) {
    if (!data.documents[doc]?.file) {
      errors[doc] = "This document is required"
    }
  }

  return errors
}

export function verifyOCRResult(
  docType: string,
  extractedText: string,
  formData: ApplicationFormData
): OCRVerification {
  const text = extractedText.toLowerCase()
  const applicantName = `${formData.firstName} ${formData.middleName} ${formData.lastName}`
    .toLowerCase()
    .trim()
  const firstName = formData.firstName.toLowerCase()

  switch (docType) {
    case "mci_certificate": {
      const mciNumber = formData.mciCouncilNumber.toLowerCase()
      const numberFound = mciNumber && text.includes(mciNumber)
      const nameFound = firstName.length > 2 && text.includes(firstName)
      if (numberFound && nameFound) {
        return {
          verified: true,
          extractedText,
          matchedField: `Registration: ${formData.mciCouncilNumber}`,
          confidence: "high",
          message: "MCI number and name verified successfully",
        }
      }
      if (numberFound || nameFound) {
        return {
          verified: true,
          extractedText,
          matchedField: numberFound ? `Registration: ${formData.mciCouncilNumber}` : `Name: ${firstName}`,
          confidence: "medium",
          message: numberFound
            ? "MCI number matched, name not clearly found"
            : "Name matched, MCI number not clearly found",
        }
      }
      return {
        verified: false,
        extractedText,
        matchedField: "",
        confidence: "low",
        message: "Could not verify MCI number or name in document. Please check the upload.",
      }
    }

    case "pg_degree_certificate":
    case "mbbs_degree_certificate": {
      const nameFound = firstName.length > 2 && text.includes(firstName)
      const degreeKeywords = ["degree", "certificate", "university", "college", "bachelor", "master", "surgery", "medicine"]
      const isDegreeDoc = degreeKeywords.some((kw) => text.includes(kw))
      if (nameFound && isDegreeDoc) {
        return {
          verified: true,
          extractedText,
          matchedField: `Name: ${applicantName}`,
          confidence: "high",
          message: "Name and degree document verified",
        }
      }
      if (nameFound) {
        return {
          verified: true,
          extractedText,
          matchedField: `Name: ${firstName}`,
          confidence: "medium",
          message: "Name found in document",
        }
      }
      return {
        verified: false,
        extractedText,
        matchedField: "",
        confidence: "low",
        message: "Could not verify name in degree certificate. Please check the upload.",
      }
    }

    case "asi_member_certificate": {
      const asiNumber = formData.asiMembershipNo.toLowerCase()
      const numberFound = asiNumber && text.includes(asiNumber)
      const nameFound = firstName.length > 2 && text.includes(firstName)
      if (numberFound) {
        return {
          verified: true,
          extractedText,
          matchedField: `ASI No: ${formData.asiMembershipNo}`,
          confidence: "high",
          message: "ASI membership number verified",
        }
      }
      if (nameFound) {
        return {
          verified: true,
          extractedText,
          matchedField: `Name: ${firstName}`,
          confidence: "medium",
          message: "Name found in ASI certificate, number not matched",
        }
      }
      return {
        verified: false,
        extractedText,
        matchedField: "",
        confidence: "low",
        message: "Could not verify ASI membership details",
      }
    }

    case "letter_hod": {
      const hodKeywords = ["head", "department", "hod", "professor", "certify", "hereby"]
      const isHODLetter = hodKeywords.some((kw) => text.includes(kw))
      const nameFound = firstName.length > 2 && text.includes(firstName)
      if (isHODLetter && nameFound) {
        return {
          verified: true,
          extractedText,
          matchedField: "HOD Letter verified",
          confidence: "high",
          message: "Letter from HOD verified with applicant name",
        }
      }
      if (isHODLetter) {
        return {
          verified: true,
          extractedText,
          matchedField: "HOD Letter detected",
          confidence: "medium",
          message: "Appears to be an HOD letter, name not clearly matched",
        }
      }
      return {
        verified: false,
        extractedText,
        matchedField: "",
        confidence: "low",
        message: "Could not verify as HOD letter",
      }
    }

    case "active_license": {
      const licenseKeywords = ["license", "registration", "practice", "valid", "medical"]
      const isLicense = licenseKeywords.some((kw) => text.includes(kw))
      const nameFound = firstName.length > 2 && text.includes(firstName)
      if (isLicense && nameFound) {
        return {
          verified: true,
          extractedText,
          matchedField: "Active license verified",
          confidence: "high",
          message: "Practice license verified with name",
        }
      }
      return {
        verified: isLicense,
        extractedText,
        matchedField: isLicense ? "License document detected" : "",
        confidence: isLicense ? "medium" : "low",
        message: isLicense
          ? "Appears to be a license document"
          : "Could not verify as practice license",
      }
    }

    default:
      return {
        verified: false,
        extractedText,
        matchedField: "",
        confidence: "low",
        message: "Unknown document type",
      }
  }
}
