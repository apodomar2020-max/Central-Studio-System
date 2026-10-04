# Source safety snapshot

Original workspace preserved without checkout, reset, stash, or staging.

Branch: `chore/mobile-expo-sdk-57-upgrade`

HEAD: `abbff5598a4150e4008b82e2f33650bd9f2ae134`

Verified production base: `e04203aed8d841c8e42c9ad54c2f530c570b3f5b`

Original status before reconciliation:

```
 M artifacts/api-server/package.json
 M artifacts/api-server/src/lib/authHelpers.ts
 M artifacts/api-server/src/lib/errorMonitoring.ts
 M artifacts/api-server/src/lib/logger.ts
 M artifacts/api-server/src/lib/pushNotifications.ts
 M artifacts/api-server/src/lib/queue.ts
 M artifacts/api-server/src/lib/socialProviders.emailTrust.test.ts
 M artifacts/api-server/src/lib/socialProviders.ts
 M artifacts/api-server/src/lib/studentDeletionPermanentDelete.ts
 M artifacts/api-server/src/routes/index.ts
 M artifacts/api-server/src/routes/socialAuth.ts
 M artifacts/api-server/src/routes/students.deletionPermanentDelete.integration.test.ts
 M artifacts/api-server/src/routes/students.ts
 M artifacts/api-server/src/worker.ts
 M artifacts/central/app.json
 M artifacts/central/app/(tabs)/profile.tsx
 M artifacts/central/app/_layout.tsx
 M artifacts/central/app/auth/login.tsx
 M artifacts/central/app/auth/register.tsx
 M artifacts/central/components/AppleSignInButton.tsx
 M artifacts/central/components/PushRegistrationGate.productionPath.test.ts
 M artifacts/central/components/PushRegistrationGate.tsx
 M artifacts/central/components/SocialLinkVerifyModal.tsx
 M artifacts/central/contexts/AppContext.tsx
 M artifacts/central/eas.json
 M artifacts/central/hooks/useGoogleSignIn.ts
 M artifacts/central/package.json
 M lib/api-client-react/src/generated/api.schemas.ts
 M lib/api-client-react/src/generated/api.ts
 M lib/api-spec/openapi.yaml
 M lib/api-zod/src/generated/api.ts
 M lib/db/migrations/meta/_journal.json
 M lib/db/src/schema/index.ts
 M lib/db/src/schema/notifications.ts
 M pnpm-lock.yaml
?? "Md Files/ADMIN_DASHBOARD_TOTAL_REVENUE_REMOVAL_REPORT.md"
?? "Md Files/ANTIGRAVITY_SPLASH_LOADING_CORRECTIVE_VERIFICATION.md"
?? "Md Files/APP_FAQ_CATEGORIES_IMPLEMENTATION_PLAN.md"
?? "Md Files/APP_FAQ_CATEGORIES_INVESTIGATION_REPORT.md"
?? "Md Files/BALLET_ASSESSMENT_IMPLEMENTATION_SPEC.md"
?? "Md Files/BALLET_FAQ_CATEGORIES_IMPLEMENTATION_PLAN.md"
?? "Md Files/BALLET_FAQ_CATEGORIES_INVESTIGATION_REPORT.md"
?? "Md Files/BREVO_EMAIL_MIGRATION_INVESTIGATION_REPORT.md"
?? "Md Files/CENTRAL_STUDIO_ADMIN_UI_RECONSTRUCTION_BLUEPRINT_V1.md"
?? "Md Files/CENTRAL_STUDIO_DESIGN_SYSTEM.md"
?? "Md Files/CENTRAL_STUDIO_ORG_BUILDER_MASTER_SPEC (1).md"
?? "Md Files/CHANGE_PASSWORD_FORGOT_CURRENT_UX_INVESTIGATION.md"
?? "Md Files/CHANGE_PASSWORD_FORGOT_CURRENT_UX_PLAN.md"
?? "Md Files/CODEX_PHASE_1_AUDIT_PROMPT.md"
?? "Md Files/CODEX_PHASE_2_IMPLEMENTATION_PROMPT.md"
?? "Md Files/DANCE_STYLES_CMS_PLAN.md"
?? "Md Files/DEPLOY.md"
?? "Md Files/DESIGN_GAP_REPORT.md"
?? "Md Files/FINANCE_CODE_COMMIT_METADATA_FIX_REPORT.md"
?? "Md Files/FINANCE_FINAL_CLOSURE_BATCH_1_CONTROLLED_RELEASE_PLAN.md"
?? "Md Files/FINANCE_FINAL_CLOSURE_BATCH_1_RELEASE_READINESS.md"
?? "Md Files/FINANCE_FINAL_CLOSURE_BATCH_1_REPORT.md"
?? "Md Files/FINANCE_FINAL_CLOSURE_BATCH_1_REVIEW_RESPONSE.md"
?? "Md Files/FINANCE_NEXT_CURSORS_NORMALIZATION_REPORT.md"
?? "Md Files/FINANCE_OPERATIONAL_AMOUNT_VISIBILITY_REPORT.md"
?? "Md Files/FINANCE_ROLES_PERMISSIONS_INTEGRATION_REPORT.md"
?? "Md Files/Finance_Phase_2B_4_Release_Prompt.md"
?? "Md Files/HOW_TO_RUN.md"
?? "Md Files/OTP_IMMEDIATE_EXPIRY_FIX_PLAN.md"
?? "Md Files/OTP_IMMEDIATE_EXPIRY_INVESTIGATION_REPORT.md"
?? "Md Files/OTP_SEND_LIMITS_POLICY_INVESTIGATION.md"
?? "Md Files/OTP_SEND_LIMITS_POLICY_PLAN.md"
?? "Md Files/PASSWORD_RECOVERY_CHANGE_INVESTIGATION_REPORT.md"
?? "Md Files/PASSWORD_RECOVERY_CHANGE_MOBILE_FIX_PLAN.md"
?? "Md Files/RESET_PASSWORD_RESEND_OTP_FIX_PLAN.md"
?? "Md Files/RESET_PASSWORD_RESEND_OTP_INVESTIGATION.md"
?? "Md Files/SECURITY_ASSESSMENT copy.md"
?? "Md Files/SECURITY_ASSESSMENT.md"
?? "Md Files/STUDIO_WALKIN_EXPLICIT_SETTLEMENT_HOTFIX_REPORT.md"
?? "Md Files/STUDIO_WALKIN_EXPLICIT_SETTLEMENT_POLICY.md"
?? "Md Files/SYSTEM_USERS_ROLES_PERMISSIONS_INVESTIGATION_REPORT.md"
?? "Md Files/SYSTEM_USERS_ROLES_PERMISSIONS_PHASE1_CLOSURE_REPORT.md"
?? "Md Files/SYSTEM_USERS_ROLES_PERMISSIONS_PHASE2A_SUPER_ADMIN_OPERATIONAL_SAFETY_REPORT.md"
?? "Md Files/SYSTEM_USERS_ROLES_PERMISSIONS_PHASE2C_BALLET_PAYMENTS_RECONCILIATION_REPORT.md"
?? "Md Files/SYSTEM_USERS_ROLES_PERMISSIONS_PHASE2_INVESTIGATION_REPORT.md"
?? "Md Files/ballet_assessment_dates_audit.md"
?? "Md Files/implementation_plan2.md"
?? "Md Files/instructor_investigation_report.md"
?? "Md Files/phase1_classes_investigation_report.md"
?? "Md Files/push_notifications_investigation_report.md"
?? "Md Files/replit.md"
?? artifacts/api-server/src/lib/appleAuthorization.ts
?? artifacts/api-server/src/lib/appleIdentity.test.ts
?? artifacts/api-server/src/lib/appleIdentity.ts
?? artifacts/api-server/src/lib/customerAccountDeletion.ts
?? artifacts/api-server/src/lib/logger.privacy.test.ts
?? artifacts/api-server/src/lib/pushReceiptProtocol.test.ts
?? artifacts/api-server/src/lib/pushReceiptProtocol.ts
?? artifacts/api-server/src/lib/pushReceipts.integration.test.ts
?? artifacts/api-server/src/lib/pushReceipts.ts
?? artifacts/api-server/src/routes/accountDeletion.integration.test.ts
?? artifacts/api-server/src/routes/accountDeletion.ts
?? artifacts/api-server/src/routes/appleAuth.integration.test.ts
?? artifacts/central/app/account/delete.tsx
?? artifacts/central/hooks/useAppleSignIn.ts
?? artifacts/central/hooks/useDeletionProviderCleanup.ts
?? artifacts/central/services/accountDeletion.ts
?? artifacts/central/services/telemetryPrivacy.test.ts
?? artifacts/central/services/telemetryPrivacy.ts
?? docs/deployment/encryption-key-rotation-report.md
?? docs/deployment/ios-final-gate-evidence/backend-baseline-diagnostics.txt
?? docs/deployment/ios-final-gate-evidence/backend-current-diagnostics.txt
?? docs/deployment/ios-production-deployment-gate-report.md
?? docs/deployment/ios-release-readiness-phase3-phase4.md
?? docs/deployment/ios-sdk57-alignment-delta.md
?? lib/db/migrations/0126_apple_credentials.sql
?? lib/db/migrations/0127_customer_deletion_requests.sql
?? lib/db/migrations/0128_push_receipts.sql
?? lib/db/src/schema/appleCredentials.ts
?? lib/db/src/schema/customerDeletionRequests.ts
?? scripts/captureAttendanceCorrected.js
?? scripts/captureAttendanceCorrected.ts
?? scripts/captureVisualQaScreenshots.ts
?? scripts/seedAdminUser.js
?? scripts/seedVisualQaCalendar.ts

```
