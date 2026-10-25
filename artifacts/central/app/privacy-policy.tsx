import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { customFetch } from "@workspace/api-client-react";
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import CentralBackButton from "@/components/CentralBackButton";

const LOGO = require("@/assets/images/privacy-policy-hero-logo.png");

const FALLBACK_PAGE = {
  title: "Privacy Policy",
  subtitle: "Effective date: October 10, 2026 | Last updated: October 10, 2026 | Version: cs-privacy-3c00d841fa9fab08",
  content: `01. Introduction and our privacy commitment

Central Studio (referred to in this Privacy Policy as “Central Studio,” “we,” “us,” or “our”) provides dance education, classes, studio-related experiences and the Central Ballet Program in Egypt. We respect the privacy of students, parents and legal guardians, instructors, visitors, applicants and everyone who engages with our services. This Privacy Policy explains what personal data we collect, where it comes from, why we process it, who may receive it, how long we keep it, how we protect it, and how individuals can exercise their privacy rights.

Our services involve more than a website. Personal information may be processed when you browse centralstudioco.com, use the Central Studio mobile application, create an account, sign in, enrol yourself or a child, buy or use a class package, reserve a class, attend a lesson, interact with our Ballet Program, contact our team or participate in studio events. The kinds of information used depend on the particular service. We seek to collect information relevant to a defined purpose, limit access to personnel who need it, and explain material uses and choices.

This document is a privacy notice, not a substitute for separate booking terms, payment conditions, participation waivers, child-safety procedures or optional photography and marketing consents. If those documents apply, they should be presented separately at the relevant point in the service. We do not treat acceptance of this notice as blanket permission for optional marketing, advertising tracking, or publication of a person’s image.

02. Who we are and who controls the data

Central Studio is the legal and business name of the studio operating in Egypt. For personal information that we collect to administer our own accounts, services, classes, applications, payments and communications, Central Studio generally determines the purposes and essential means of processing and acts as the data controller under applicable law. Service providers may act as processors on our behalf or as independent controllers for their own separately disclosed services, depending on their role.

Central Ballet is a programme associated with Central Studio; references to it do not automatically mean that information is transferred to a separate unrelated business. If a programme, production or event has an additional organiser that independently controls information, its identity and applicable terms should be disclosed when a person joins that activity.

Our main contact for privacy questions, access/correction requests and deletion requests is support@centralstudioco.com. General business enquiries may be sent to info@centralstudioco.com. Our telephone number and main-studio address appear in Section 24. We will not identify a named statutory data-protection officer or claim registration with a regulator unless such appointment and registration are confirmed.

03. Scope of this policy

This Policy applies, as relevant, to (a) the Central Studio public website and its public content, contact pages and forms; (b) the Central Studio mobile application on iOS and Android; (c) customer registration, authentication, profiles and account settings; (d) studio classes, schedules, packages, bookings, attendance, credits and payments; (e) the Central Ballet Program, assessments and related communications; (f) studio events and authorised photography; and (g) customer-support and privacy-rights interactions conducted online, by phone or at the studio.

Different channels have different features. For example, website security tools may differ from native-app authentication; the mobile app can use push-notification permissions while the website may use browser storage or cookies. Descriptions in this Policy therefore indicate when processing depends on a feature being used or a choice being made. The Policy does not imply that every listed feature or data field is collected from every visitor.

External websites, social-network platforms, app stores and payment services may operate their own data practices. Links to those services do not make their independent privacy policies part of this document. Please review relevant provider notices when you use a third-party account, external site or payment option. Where our personnel process employment-related information solely through separate internal systems, an appropriate employment notice may also apply.

04. People covered by this policy

This Policy covers adults who browse or purchase services; students who take classes; parents, guardians and authorised family-account users; children and teenagers participating through an authorised parent or guardian; Ballet Program applicants and participants; event participants; visitors who ask questions but do not create an account; and people who contact us about an incident, privacy request, support issue or complaint.

The information we need for each group differs. For example, a casual visitor may generate limited technical access data, while a registered student may have an account, a class history and payment or attendance records. A parent managing a child’s programme may provide both their own contact details and the child’s participation information. An individual who participates in photography or a performance may be asked for a separate image-use decision.

People submitting information about someone else must have lawful authority to do so. This is particularly important for parents, guardians and other adults managing children’s information. We may request limited information reasonably necessary to verify authority or prevent unauthorised disclosure; the verification process should not demand excessive documentation.

05. Categories of personal information we collect

Depending on your relationship with Central Studio, personal information may include:

Identity and contact information: full name, email address, mobile number, date of birth or age category where relevant to eligibility, and profile photograph if supplied. Family and guardianship information: a child’s name, age/date of birth where needed, parent or guardian details, relationship, emergency or authorised contact information if collected, and relevant permissions. Account and authentication information: internal account identifiers, verified email status, authentication-provider identifiers, session and device-token records, password-related authentication data handled securely, and account security/audit events; we do not need your social provider’s password.

Service participation information: chosen dance style, instructor, class level, date/time, class reservation, attendance and absence status, schedule changes, availability and QR/check-in activity where available. Package and financial information: package purchased, package category and entitlement, historical order details, price or captured payment amount where recorded, payment method and status, transaction references, discounts, credits used or remaining, expiry and refund/cancellation records. A payment provider may process payment credentials; our own stored data should be limited to the records needed to reconcile purchases and comply with law.

Ballet and education-related information: programme application, assessment appointment, level/group assignment, assessment outcome, class placement, performance participation and relevant programme communications. Sensitive or safety-related information: health, injury, physical restrictions or accessibility details only when actually requested and necessary for a documented safety, suitability or support purpose; sensitive information should not be collected merely because it might be useful. Media and creative materials: profile photos, photographs/video recorded at activities, consent records, audition/performance material if submitted, and published-content requests.

Technical and interaction information: IP address and connection metadata, device/operating-system information, app version, device or app identifiers, diagnostic/crash/performance events, security signals, cookie or local-storage information on the website, push tokens and notification preferences. Communications and support information: enquiry text, correspondence, support case history, feedback and records of privacy choices or consent. We may receive limited information from integrated service providers as explained below.

06. How and where information is collected

We receive information directly from you when you register, edit a profile, contact us, provide details for a child, submit a Ballet assessment, book a class, pay for a package, report an issue or make a privacy request. Staff may enter authorised information from in-person transactions, consultations or studio registrations into our operational systems, following relevant internal procedures.

We may obtain information from your authorised guardian or account manager, for example when a parent registers or manages a child, or from identity providers you choose for sign-in. Apple, Google or Facebook may return a provider identifier, name or email, subject to the permissions, provider response and privacy settings for the selected sign-in flow. Some providers disclose a relay email rather than your underlying address.

Certain information is generated when services are used, such as login timestamps, requests to our servers, class bookings, attendance, credit movements, push-token registration and technical error logs. Our website may store essential session or preference data and may use additional browser technologies only in accordance with their configuration and applicable requirements. Third-party providers may separately collect limited technical information under their own terms or their role in delivering our services. We do not treat a user’s mere presence on a page as consent to an unrelated optional use.

07. Purposes and lawful grounds for processing

We process data for identified operational purposes, using the lawful ground appropriate to the activity and law. Service performance and customer requests: creating accounts, authenticating users, scheduling lessons, recording bookings, delivering paid or booked sessions, handling programme applications, allocating instructors/groups and providing account support. Legal compliance and rights: maintaining necessary tax, accounting, financial, dispute, safety, consent and audit records where required or justified. Legitimate operational interests where lawful and properly balanced: protecting systems, preventing misuse, improving reliability, detecting fraud, understanding service demand and ensuring business continuity without disproportionate intrusion.

Consent-dependent activities: optional direct marketing, certain sensitive-data processing, publication of personal photographs or video for promotion, and optional technologies or tracking when applicable. Where consent is the ground, we will seek a meaningful and specific choice and allow withdrawal through the stated mechanism, subject to legal constraints and processing already lawfully completed. Consent to join a class is not automatically consent to public media promotion.

We do not intentionally reuse student, payment, child or sensitive safety information for unrelated advertising or profiling merely because we originally obtained it for studio services. If we introduce a materially different processing purpose, we will assess the legal requirements and provide any additional notice or choice before doing so. Processing terms such as “contract,” “legal obligation,” “consent” or “legitimate interest” will be applied only where permitted by applicable Egyptian or other governing law.

08. Accounts, authentication and social sign-in

Central Studio supports account-based services. Depending on the available flow, users may register with email, receive a one-time verification code (OTP), set or reset an authentication credential, and sign in through supported identity providers such as Apple, Google and Facebook. We process the identifiers and verification outcomes required to establish identity, protect accounts, associate the right bookings and packages with a user, prevent impersonation, manage sessions, and deliver password recovery or security notices.

One-time verification codes are security credentials and should not be sent to anyone other than the authorised user; staff should not request that a user disclose an OTP in an ordinary support conversation. We may retain security events or limited audit records needed to detect account abuse, investigate support issues or meet lawful requirements. Sign-in providers may receive information involved in their authentication flow and process it under their own privacy terms. Facebook Login integration has additional provider-specific disclosures in Section 17.

Account holders should keep their contact information accurate, avoid sharing credentials and promptly notify our support team of suspected unauthorised access. Where account-linking or social-provider disconnection is available, removing a provider connection is not necessarily the same action as deleting the entire Central Studio account. For account deletion, see Section 22.

09. Classes, bookings, check-in and attendance

When you view or book a class, we may process the class identifier, dance style, day/time, level, instructor, studio or venue, reservation status, participant identity, package entitlement and capacity-related information. When participation occurs, we may record attendance, check-in events, cancellations, no-shows or changes needed to keep schedules accurate. QR-based check-in, if used, may associate a code or attendance credential with an authorised booking or account; it should not be treated as a public identification code.

We use this information to confirm eligibility, prevent overbooking, allocate space and teachers, maintain an accurate class history, inform students of changes, apply package credits according to the relevant terms and resolve booking disputes. Relevant members of staff and instructors may access only the information needed to run classes safely and effectively. A teacher does not require general access to a student’s payment history merely to confirm attendance.

Booking and attendance records may need to remain available after a lesson to support customer enquiries, accounting, fraud prevention, safety incidents or legitimate disputes. A cancellation or failure to attend does not by itself erase those records. Specific cancellation, refund and package-credit rules belong in the applicable service terms, not solely in this privacy notice.

10. Packages, credits, payments and historical financial records

For purchases and package use, we may process package names and identifiers, included sessions, start and expiry dates, purchase and payment status, receipt or order reference, discount or promotion, recorded amount, remaining credits, transaction status, cancellation/refund records and related audit history. Payment may be completed online through an available provider or by a studio payment arrangement; particular providers and accepted methods may change by service. We should not receive or store full card security codes when those are processed by a third-party payment processor.

We use financial and package records to identify valid entitlements, process purchases, reconcile payments, prevent double use, respond to disputes, meet accounting requirements, and document historical transactions. Removing or deactivating a package from the public catalogue does not automatically erase an earlier customer purchase or historical transaction. A stored unused balance on an expired, cancelled or otherwise ineligible historical order is not necessarily credit that can currently be spent. Operational displays should distinguish available credit from historical remaining sessions.

A package’s historical amount must not be reconstructed from the current catalogue price unless reliable contemporaneous records support that figure. If a historical price or expiry cannot be established, we will not knowingly invent it. Where required, legally significant transaction records may survive account deletion in restricted or de-identified form for the relevant retention period. Deletion of financial history solely at a user’s request may be limited where a lawful obligation or valid claim requires it.

11. Central Ballet Program, applications and assessments

Central Ballet involves programme information and may include enrolment applications, assessment bookings, instructor assignments, level placement, group allocation, class schedules, programme subscriptions, requirements and performance participation. Depending on the specific workflow, we may record assessment dates, attendance, evaluation status and educational outcomes needed to administer a student’s placement. Access should be limited to authorised programme and administrative personnel.

Parents or guardians may provide details of minors participating in the programme, in accordance with the safeguards described in Section 12. Any health, injury or accommodation information collected for a Ballet activity should be separately justified, restricted, and not repurposed for publicity. Photographs or footage connected with performances are addressed in Section 14; participating in an assessment alone is not agreement to public marketing use.

Programme records may be retained while participation is active and afterward to the limited extent needed to verify placements, respond to enquiries, document authorised financial dealings or defend legitimate claims. Individuals may request correction of inaccurate administrative details; assessment outcomes may also be governed by documented educational review rules rather than automatic alteration on request.

12. Children, parents and legal guardians

We offer services involving children and teenagers, and therefore apply additional care to identifying the lawful person providing information and authorising participation. Where a child cannot independently give legally valid consent or enter the relevant agreement, a parent or authorised legal guardian must complete or approve the applicable registration and permissions. We may process limited relationship and contact information to verify that authority and to communicate about class schedules, emergencies, programme decisions and participation.

Children’s information should be used for registration, delivery of age-appropriate services, safety, attendance, legitimate records and authorised communication—not automatically for targeted advertising or public-facing promotional profiles. Staff and instructors should be given role-appropriate access only. Public release of a child’s identifiable photographs or video requires an appropriate, separately documented parental/legal-guardian media decision where required. An opt-out from promotional media must not, by itself, prevent participation in ordinary classes unless a separately disclosed event condition lawfully requires recording.

A guardian may request access to, correction of or deletion of a child’s information to the extent permitted by law and the relevant parental/guardianship authority. We may need to verify the requester’s relationship and consider the child’s rights and safety before releasing information. If we learn that information was submitted without appropriate authority, we will assess and take proportionate action, including restriction or deletion where warranted. Children should not send us sensitive documents through informal social-media messages.

13. Health, fitness, accessibility and safety details

Dance can involve physical activity. Where it is reasonably necessary for safe participation or an appropriate accommodation, we may ask about an injury, activity restriction, accessibility need, emergency consideration or other relevant health or fitness circumstance. We aim to obtain only information necessary for the stated purpose rather than complete medical histories. Providing such information may be subject to additional safeguards and appropriate consent or other lawful basis where required for sensitive personal data.

This information is used to evaluate reasonable adjustments, communicate safety considerations to authorised staff and manage an incident. It should not be incorporated into public profiles, sold for advertising, or made accessible to staff who have no safety or service role. We may share relevant details with an appropriate emergency responder when required to protect a person, in accordance with applicable law. Central Studio is a dance-service provider, not a healthcare institution; this Policy does not claim that classes provide medical diagnosis or treatment.

Individuals and guardians should notify us when relevant safety information changes, through an approved channel. Retention must be limited to an appropriate participation, incident, legal or safeguarding need; sensitive details should be deleted or minimised once that purpose ends, subject to specific legal obligations.

14. Photography, video, performances and media consent

Photography and video may occur at authorised performances, events, recitals, rehearsals or studio activities. Different uses require different treatment: internal service documentation, restricted sharing with participants, and public/promotional use on our website, social media, advertising or press materials are not the same purpose. A person’s ordinary participation in class is not blanket permission to use their identifiable image, name or performance for advertising.

Where required, we will use an appropriate media permission or release identifying the intended media, purposes, channels, duration or other material conditions, and the person giving permission. For minors, relevant consent must be provided by a legally authorised parent/guardian and may require additional safeguards. Permission for one event or purpose does not automatically extend to unrelated future campaigns. The service team must honour recorded refusals and applicable restrictions when preparing promotional content.

Individuals may contact support@centralstudioco.com to ask about image use, withdraw consent where processing is consent-based, or request removal from channels under our control. We will assess lawful rights and practical limitations. Withdrawal does not retroactively make already lawful use unlawful; we may not be able to retrieve printed materials already distributed, archived third-party copies or content independently reposted by others, but we will address removal from channels we control where required and feasible.

15. Notifications, service communications and direct marketing

We may contact users about account verification, security, booking confirmation, changes to a class, attendance, reminders, package status, renewal information, important programme notices or support requests. Such operational communication may be necessary to deliver an expected service and can use appropriate email, in-app notices or device push notifications. The mobile application may register a push token so that the notification service can route authorised notifications to the correct device. Notification permission can generally be controlled through device settings; disabling it may prevent delivery of time-sensitive push reminders without preventing other essential contact.

Optional promotional email, messaging or other direct marketing is separate from essential account/service communications. Where marketing requires prior consent, we will obtain it and keep an appropriate consent record; we will provide an accessible method to opt out or withdraw consent, and comply with applicable Egyptian direct-marketing rules. We will not assume that creating an account or booking a class authorises unrelated electronic promotions. Opting out of marketing should not stop messages essential to a current booking or legitimate security notice.

Communication providers process routing and delivery data for the messages they handle. Users should avoid placing passwords, verification codes or unnecessary sensitive information in replies to ordinary marketing emails or public comments. We may retain communication history as necessary to resolve enquiries, honour preferences and demonstrate compliance.

16. Website cookies, local storage and similar technologies

Our website may use strictly necessary cookies or browser storage to maintain site functionality, protect sessions, remember certain choices and defend against automated abuse. Depending on the website’s deployed configuration, it may also use non-essential measurement, analytics, embedded-content or marketing technologies. The categories, providers, purposes, lifetimes and controls for any such non-essential technologies should be identified accurately in a cookie notice or preferences interface if required by law.

The website may use Cloudflare Turnstile or similar protective mechanisms on relevant web forms to distinguish automated abuse from legitimate requests. These tools may process technical signals in accordance with the provider’s applicable privacy terms and the tool configuration. The native Central Studio mobile app does not present the website’s Turnstile challenge as part of its current native authentication flow. Other website scripts and embeds must be reviewed independently.

Users can manage many browser cookies through browser settings; blocking essential storage may impair account or form operation. Where consent is required for optional cookies, browser configuration alone may not substitute for the site’s own required consent mechanism. We will not assert that only essential cookies are used until the deployed website and third-party scripts have been inspected.

17. Mobile SDKs, analytics, diagnostics and possible tracking

Our mobile app incorporates third-party software components that help deliver login, security, crash/performance diagnostics, device notifications and platform features. Components may include Apple/Google sign-in support, Meta/Facebook Login software, Expo notification-related services and Sentry diagnostics. Each component may handle identifiers or event information appropriate to its operation; the exact data types depend on the software version, configuration, feature used, and provider practices. Sentry is configured to support error monitoring with privacy-reducing controls, but diagnostic events can still contain technical device and application information.

Meta/Facebook Login disclosure. The app includes Meta SDK components for Facebook Login. Disabling Facebook automatic app-event logging and collection of advertiser ID through app-level settings should not be interpreted as proof that every SDK communication or information flow is disabled. Meta SDK privacy manifests may declare categories including device identifiers, product interaction, crash-related or other data, and designate certain possible practices as tracking. Any actual processing must be assessed against provider documentation, effective configuration and where feasible runtime evidence; the app’s store disclosures must reflect the practices that actually apply.

Advertising tracking and consent. If Central Studio or an integrated provider processes information in a manner constituting tracking under applicable platform rules—for example by linking app data with information from unrelated companies for targeted advertising or advertising measurement—required transparency and permissions, including Apple App Tracking Transparency where applicable, must be implemented before that processing. We do not describe absent permission prompts as proof that tracking is technically impossible. Users can choose whether to use optional social sign-in methods and may use alternative supported login options.

18. Service providers, recipients and disclosures

We may disclose appropriately limited information to providers engaged to help deliver Central Studio services. Relevant provider categories can include hosting and application infrastructure (server operation, databases, secure storage and backups), authentication and social sign-in providers (Apple, Google, Meta where selected), email and push delivery providers, payment processing and financial service providers where applicable, crash/performance monitoring (for example Sentry), customer support or communication tools, and authorised operational professionals such as accountants or legal advisers where justified.

The information shared depends on the service: a notification-routing service generally needs an appropriate device token and message metadata, while a payment processor needs transaction and payment details, and a teacher needs relevant class/attendance information. Providers may act as processors under our instructions or as independent controllers where the service requires them to determine certain purposes independently; their applicable notices should be consulted. We aim to use necessary contractual, technical and organisational safeguards appropriate to the role and information involved.

We may also disclose information to authorities when legally required, in response to lawful processes, to protect rights and safety, or in connection with a legitimate corporate restructuring subject to required protections and notice. We do not treat a public social-media post or voluntary use of an external link as information necessarily collected through our own application. A complete, current inventory of processors and data flows should be maintained internally and reflected in disclosures where legally necessary.

19. International storage and transfers

Central Studio is based in Egypt, but some digital providers supporting our website, app, authentication, backup, communications or diagnostics may host, access or process data outside Egypt. The country of a particular server, data centre or support operation can vary by provider, contractual configuration and feature. We do not promise that all information stays within Egypt unless confirmed for each relevant service.

Before transferring personal data across borders, we assess the applicable legal conditions, transfer restrictions, authorisations and safeguards, including the Egyptian Personal Data Protection Law No. 151 of 2020 and its Executive Regulations and any other law that materially applies. Depending on the circumstances, safeguards may include appropriate contractual obligations, security controls, access limitations, consent where required and regulatory steps. Some identity or app-store services may be independently provided by international organisations under their own terms.

Individuals may contact us at the privacy email for information about relevant processing locations and safeguards, subject to confidentiality and security constraints. The absence of a named country in this notice should not be read as a claim that no international processing takes place.

20. Security and organisational safeguards

We seek to protect personal information using measures proportionate to the information and risks involved, including secure network connections, controlled administrative access, authorisation and role restrictions, account-security checks, validation, appropriate logging, data minimisation, service monitoring and business-continuity or backup practices. We also seek to restrict personal information shared with staff and providers to what they need for their authorised work. Highly sensitive functions such as financial adjustments, account deletion or role changes warrant stronger controls and traceability.

No system, transmission or storage method can be guaranteed completely secure. Accordingly, this notice does not claim blanket compliance with SOC 2, annual penetration-test certification, encryption of every field, or other external assurance not supported by current verified evidence. If we identify a suspected incident involving personal information, we will investigate, limit harm, retain necessary evidence and provide notification to affected people or authorities where required by law.

Users should choose suitable account credentials, protect their access to their devices, avoid sharing OTPs, and contact support@centralstudioco.com if they suspect account compromise or an unauthorised disclosure. Security logs may be retained for a justified period to investigate incidents and protect users, even after an ordinary account session ends.

21. How long we retain information

We retain personal information for as long as reasonably necessary for its identified purpose and applicable legal obligations, then delete, anonymise, restrict or securely dispose of it as appropriate. The period depends on the record type; this notice does not create one universal deletion date for every system. Account/profile details are ordinarily relevant while the account is active, with limited continued processing when needed for deletion handling, security or disputes. Bookings, class and programme records may remain after a session to support operations, claims, safety and customer queries. Payment, invoice, credit-ledger and financial history may have longer statutory, accounting or evidentiary retention needs.

Guardian and child information should be reviewed with particular care and minimised when the participation or protection purpose ends. Health/safety details should be kept no longer than their documented safeguarding or incident purpose requires. Media consent records may be retained while the relevant image use continues and afterward to document the lawful basis and honour restrictions. Diagnostics, security logs, device tokens and support correspondence each have separate operational life cycles; stale push tokens and unnecessary logs should be removed according to the applicable process.

Backup and disaster-recovery copies may continue to contain data after it has been removed from live systems. Their retention should be limited to justified recovery, security and legal needs; access should be restricted, and restoration should preserve applicable deletion and retention restrictions. We do not claim instant deletion from every backup or a fixed backup-erasure deadline. Retention and deletion decisions depend on the record’s purpose, applicable legal and financial obligations, security needs and operational dependencies, and remain subject to applicable privacy rights.

22. Account deletion, erasure and records that may remain

If you have a Central Studio account, you can initiate an account-deletion request using the account-deletion control made available within the mobile app’s account/profile settings. If you cannot access the app, need help with a former account or act as an authorised guardian, email support@centralstudioco.com with a request to delete the relevant account or personal information. We may take proportionate steps to verify the requester’s identity and authority before processing sensitive or irreversible instructions. Do not include a password or OTP in your email.

Our deletion process is designed to revoke authentication and access, disable relevant sessions or registered notification devices, and delete, anonymise or restrict personal information in operational account records as appropriate. Some historical transactions, attendance or programme records may need to be preserved for accounting, law, dispute resolution, fraud prevention or other justified purposes. In such cases, identifying information should be limited and access restricted where feasible. Deletion of the login/account does not necessarily erase a past payment or cancellation, reverse a completed class, or cancel a lawful record-keeping duty.

Where a request concerns a child, we will consider the legal authority of the requester and the child’s rights. Deletion or withdrawal of consent for optional published media is assessed separately from deletion of the underlying studio service account. In some circumstances we may need to explain which information can be removed immediately and which must be retained, for what purpose and under which rule. We will not promise automatic restoration of deleted packages or unused credits. Data removed from live systems may remain in backup or disaster-recovery copies; any continued retention should be limited to justified needs and subject to safeguards against unintended reactivation. This does not remove applicable rights to request erasure or restriction.

23. Privacy rights, requests, choices and complaints

Depending on the applicable law and your circumstances, you may be entitled to request information about our processing, access a copy of personal information, correct inaccurate or incomplete data, request deletion or restriction, object to particular processing, withdraw consent when consent is the relevant legal basis, and complain to the competent authority. Rights may be subject to identification checks, exemptions, the rights of others and legal retention duties; not every request results in complete erasure of financial or legally relevant history.

To exercise a right, contact support@centralstudioco.com with a description of your request, a suitable way to contact you and enough information to locate the relevant account or record. Please do not send passwords, one-time codes, full card details or unnecessary medical documents. We may ask for reasonable identity or guardian verification through an appropriate channel. We will assess requests and respond within applicable legal requirements; we will explain a lawful refusal or limitation where required.

Choices also include controlling supported device push notifications, choosing an available sign-in method, managing optional promotional communications, and adjusting consent for authorised public photography or optional website technologies where available. Withdrawal of consent affects future consent-dependent processing and does not necessarily invalidate processing already lawfully performed. Individuals may seek guidance or submit complaints to Egypt’s competent Personal Data Protection Center (PDPC) where its jurisdiction applies; additional rights may exist under other applicable laws.

24. Policy updates, official contact details and complaints

We may revise this Policy when services, technology, providers, legal requirements or our data practices materially change. When a change is significant, we will use an appropriate communication method or prominent notice where required. We will display the effective date of the current approved version and retain appropriate internal change records. A revised Policy will not retroactively create consent for optional uses that require a separate affirmative decision.

Central Studio — Egypt\u0020\u0020
Legal/operator name: Central Studio\u0020\u0020
Main studio: 53, Narges 3, New Cairo, Cairo, Egypt\u0020\u0020
Telephone: +20 120 181 3112\u0020\u0020
General enquiries: info@centralstudioco.com\u0020\u0020
Privacy, access, correction and deletion: support@centralstudioco.com\u0020\u0020
Website: https://centralstudioco.com\u0020\u0020
Privacy page: https://centralstudioco.com/privacy

Please direct privacy-related questions or suspected misuse of your data to the dedicated privacy email. General booking and class enquiries should use the regular customer-support channels.`,
};

type ContentPage = { title: string; subtitle?: string | null; content: string };

export default function PrivacyPolicyScreen() {
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<ContentPage>(FALLBACK_PAGE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    customFetch<ContentPage>("/api/content/pages/privacy-policy")
      .then((data) => active && setPage(data))
      .catch(() => active && setPage(FALLBACK_PAGE))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const topInset = Platform.OS === "web" ? 18 : insets.top + 10;

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["#111315", "#151515", "#101112"]}
        locations={[0, 0.54, 1]}
        style={[styles.fixedHero, { paddingTop: topInset }]}
      >
        <Svg style={styles.heroGlow} pointerEvents="none">
          <Defs>
            <RadialGradient id="privacyHeroGlow" cx="50%" cy="-10%" rx="120%" ry="90%">
              <Stop offset="0%" stopColor="#00B6D7" stopOpacity={0.16} />
              <Stop offset="60%" stopColor="#00B6D7" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#privacyHeroGlow)" />
        </Svg>
        <View style={styles.navRow}>
          <CentralBackButton style={styles.backButton} />
          <Text style={styles.title}>{page.title}</Text>
          <View style={styles.navSpacer} />
        </View>

        <View style={styles.logoWrap}>
          <Image source={LOGO} resizeMode="contain" style={styles.logo} />
        </View>
      </LinearGradient>

      <ScrollView style={styles.contentScroll} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.loadingBox}><ActivityIndicator size="small" color="#03BFE9" /></View>
        ) : (
          <>
            {page.subtitle ? <Text style={styles.updated}>{page.subtitle}</Text> : null}
            <Text style={styles.content}>{page.content}</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0E1010" },
  fixedHero: { height: 304, overflow: "hidden", backgroundColor: "#131414" },
  heroGlow: { position: "absolute", top: 0, left: 0, right: 0, height: 304 },
  navRow: { height: 44, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  navSpacer: { width: 34 },
  title: { flex: 1, textAlign: "center", color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 22, lineHeight: 25, textTransform: "uppercase" },
  logoWrap: { position: "absolute", top: 118, alignSelf: "center", width: 284, height: 154, alignItems: "center", justifyContent: "center" },
  logo: { width: 284, height: 154 },
  contentScroll: { flex: 1, backgroundColor: "#0E1010" },
  contentContainer: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: Platform.OS === "web" ? 44 : 32 },
  loadingBox: { minHeight: 120, alignItems: "center", justifyContent: "center" },
  updated: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 10, lineHeight: 13, marginBottom: 12 },
  content: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 10, lineHeight: 12, letterSpacing: 0.03 },
});
