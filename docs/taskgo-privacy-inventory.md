# TaskGo privacy inventory (2026-09-29)

Status: source-based preparation, not a submitted App Store Connect declaration.
Recheck the shipped build, deployed services, and Xcode privacy report before submission.

## Declared App Functionality Data

All categories below are linked to the signed-in account or its workspace and are not used for tracking. This is a conservative classification of data entered into business records, not a claim that the app reads the device's address book or processes card payments.

| Apple category | Source evidence / use |
| --- | --- |
| User ID | Account username/ID, workspace membership, task authorship |
| Email address | Notification email, customer/contact email |
| Name | Customer/contact names, contract parties |
| Phone number | Customer/contact and contract party phone fields |
| Physical address | Customer/contract addresses and job site address |
| Payment info | InvoicePaymentRecord.method records form of payment; no built-in card payment processing |
| Other financial info | Quote/contract/invoice amounts, balances and recorded receipts |
| Purchase history | Material purchases and customer invoice line items |
| Photos or videos | Uploaded job photos |
| Audio data | Uploaded/recorded job audio |
| Other user content | Job notes, signatures, transcripts, quote descriptions and company settings |
| Device ID | APNs device token for assignment notifications |

The TaskGo native `PrivacyInfo.xcprivacy` includes these categories. This file does not automatically complete the App Store Connect privacy questionnaire.

## Remaining Checks Before Submission

- Inspect actual hosting/request logs, retention, backup expiration, and any external diagnostics. The public policy mentions IP/server logs, but deployment evidence is still needed to classify diagnostic and other data accurately.
- Review email/LINE/storage/APNs providers actually enabled in production, including whether notification payloads contain job or customer content.
- Inspect the final Xcode archive's aggregated privacy report for Capacitor and all bundled dependencies, not just the app-owned manifest.
- Confirm account deletion with the deployed storage provider. Removing an account relationship does not erase a person's name or face already present in another company's retained documents/photos.
- Confirm publicly accessible privacy and support pages after deployment. Do not claim local edits are live.
- Enter and review the final categories in App Store Connect only after these checks. No tracking declaration must match the shipped dependency set.

## References

- [Apple App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)
- [Apple Collected Data Type Values](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatype)
- [Apple Privacy Manifests](https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests)
