05 — Use Cases & Business Workflows

الهدف من البند ده هو تحديد ماذا يستطيع كل Actor أن يفعل داخل النظام، وما الذي يحدث خطوة بخطوة، ومتى يحتاج الأمر إلى موافقة.

5.1 Authentication & Registration
UC-001 — User Registration

Actor: User

User
↓
Enter Registration Data
↓
Create Account
↓
Account Created

بعد التسجيل، يكون المستخدم قادرًا على استخدام الوظائف الأساسية المسموح بها لحسابه.

UC-002 — Veterinarian Registration

Actor: User

User
↓
Register as Veterinarian
↓
Veterinarian Application
↓
Pending Approval
↓
Admin
↓
Approve / Reject

إذا تمت الموافقة:

User
↓
Approved Veterinarian

ويصبح قادرًا على استخدام Veterinarian Interface والوظائف المرتبطة به.

5.2 Pet Owner Mode
UC-003 — Add Owned Animal

Actor: Pet Owner

Pet Owner
↓
Add Animal
↓
Animal Created
↓
Owner = Current User

لا يحتاج إنشاء الحيوان إلى Admin Approval طالما أن الحيوان يتم إضافته كحيوان مملوك لصاحب الحساب.

UC-004 — Transfer Animal Ownership

Actor: Current Animal Owner

Current Owner
↓
Select Animal
↓
Select New Owner
↓
Ownership Transfer
↓
New Owner

الحيوان له مالك واحد فقط في نفس الوقت.

5.3 Lost Animal
UC-005 — Report Animal as Lost

Actor: Pet Owner

Pet Owner
↓
Select Owned Animal
↓
Report as Lost
↓
Pending Approval
↓
Admin / Animal Supervisor
↓
Approve / Reject

إذا تمت الموافقة:

Lost Animal → Published
5.4 Adoption
UC-006 — Publish Animal for Adoption

Actor: Pet Owner

Pet Owner
↓
Select Animal
↓
Create Adoption Request
↓
Pending Approval
↓
Admin / Responsible Supervisor
↓
Approve / Reject
5.5 Mating
UC-007 — Publish Animal for Mating

Actor: Pet Owner

Pet Owner
↓
Select Animal
↓
Create Mating Request
↓
Pending Approval
↓
Admin / Responsible Supervisor
↓
Approve / Reject
5.6 Clinic Creation
UC-008 — Create Clinic

Actor: Approved Veterinarian

Veterinarian
↓
Create Clinic
↓
Clinic Request
↓
Pending
↓
Admin / Responsible Supervisor
↓
Approve / Reject

إذا تمت الموافقة:

Clinic → Active

والـClinic Owner هو الـVeterinarian الذي أنشأ المؤسسة.

5.7 Veterinary Office Creation
UC-009 — Create Veterinary Office

Actor: Approved Veterinarian

Veterinarian
↓
Create Veterinary Office
↓
Pending Approval
↓
Admin
↓
Approve / Reject
5.8 Store Creation
UC-010 — Create Store

Actor: Approved Veterinarian

يتم إنشاء:

Pet Owner Store
Veterinary Store

بنفس المبدأ:

Veterinarian
↓
Create Store
↓
Pending Approval
↓
Admin
↓
Approve / Reject

لكن نوع المتجر يحدد الـBusiness Model والمنتجات المتاحة له.

5.9 Farm Creation
UC-011 — Create Poultry Farm

Actor: Approved Veterinarian

Veterinarian
↓
Create Poultry Farm
↓
Pending Approval
↓
Admin
↓
Approve / Reject
5.10 Assign Veterinarian to Clinic
UC-012 — Assign Veterinarian

Actor: Clinic Owner

Clinic Owner
↓
Select Veterinarian
↓
Assign to Clinic
↓
Veterinarian Becomes Clinic Member

لا يحتاج التعيين إلى موافقة الطبيب.

لكن الطبيب يستطيع لاحقًا ترك العيادة.

والـAdmin يستطيع إدارة أو إزالة العضوية.

5.11 Join Farm
UC-013 — Join Farm Using Farm ID

Actor: Veterinarian

Farm Owner
↓
Provides Farm ID

Veterinarian
↓
Enter Farm ID
↓
Validate Farm
↓
Join Farm

لا توجد:

Invitation
Acceptance
Admin Approval

في عملية الانضمام نفسها.

بعد نجاح العملية يصبح الطبيب عضوًا في المزرعة.

5.12 Organization Supervisor
UC-014 — Assign Organization Supervisor

Actor: Organization Owner

الشخص الذي سيتم تعيينه يجب أن يكون Veterinarian.

Owner
↓
Select Veterinarian
↓
Assign as Supervisor
↓
Select Permissions
↓
Supervisor Assignment Active

يمكن للـOwner تعيين أكثر من Supervisor.

5.13 System Supervisor
UC-015 — Assign System Supervisor

Actor: Admin

Admin
↓
Open Supervisor Management
↓
View Users
↓
Select User
↓
Select Domain
↓
Assign Permissions
↓
Activate Supervisor

مثلاً:

Admin
↓
Select Veterinarian
↓
Consultation Supervisor
↓
Assign:
consultation.read
consultation.reply
consultation.close
consultation.block_sender
5.14 Medical Record
UC-016 — Manage Medical Record

Actor: Authorized Veterinarian

Veterinarian
↓
Select Clinic
↓
Search Animal
↓
Open Animal
↓
Medical Record

يمكن للطبيب المصرح له:

Read
Create
Update
Delete

Medical Records.

ولا يحتاج ذلك إلى موافقة Pet Owner.

5.15 Vaccination
UC-017 — Manage Vaccination

Actor: Authorized Veterinarian / Clinic

يمكن للطبيب المصرح له:

Add Vaccination
View Vaccination
Update Vaccination
Delete Vaccination

حسب الـPermissions.

ولا تحتاج العملية إلى موافقة Pet Owner.

5.16 Clinic Chat
UC-018 — Clinic Communication

المحادثة تكون بين:

Pet Owner ↔ Clinic

وليس بالضرورة:

Pet Owner ↔ Specific Veterinarian

الـAuthorization يحدد من يستطيع الوصول إلى محادثة العيادة.

5.17 Farm Chat
UC-019 — Farm Communication

المحادثة تكون:

Farm Owner ↔ Veterinarian
Farm Owner ↔ Employee

ولا يوجد Group Chat مفتوح لكل أعضاء المزرعة.

5.18 Consultation
UC-020 — Create Consultation

Actor: Pet Owner

Pet Owner
↓
Create Consultation
↓
Consultation Created

الـConsultation ليست مرتبطة بحيوان محدد بالضرورة.

UC-021 — AI Consultation Response

إذا كان AI مفعلًا:

Consultation Created
↓
AI Enabled?
↓
YES
↓
AI Responds Automatically
UC-022 — Human Consultation Response

يمكن لـ:

Admin
Consultation Supervisor

الرد على الـConsultation.

Consultation
↓
Supervisor / Admin
↓
Reply
UC-023 — Block Consultation Sender

Actor: Admin / Authorized Supervisor

Consultation
↓
Block Sender
↓
Sender = Read Only

بعد ذلك لا يستطيع الـSender إرسال رسائل جديدة في نفس الـThread.

5.19 Inquiry
UC-024 — Create Inquiry

Actor: Veterinarian

Veterinarian
↓
Create Inquiry
↓
Inquiry Created

الـInquiry يمكن أن تكون عامة وغير مرتبطة بحيوان.

UC-025 — AI Inquiry Response

إذا كان AI مفعلًا:

Inquiry Created
↓
AI Enabled
↓
AI Responds
UC-026 — Human Inquiry Response

يمكن أن يرد:

Admin
Inquiry Supervisor
UC-027 — Block Inquiry Sender
Admin / Inquiry Supervisor
↓
Block Sender
↓
Sender becomes Read Only
5.20 Admin Messaging
UC-028 — Send Individual Message
Admin
↓
Select User
↓
Write Message
↓
Send
UC-029 — Send Group Message
Admin
↓
Select User Category
↓
Compose Message
↓
Send

مثل:

All Veterinarians
All Pet Owners
All Supervisors
UC-030 — Broadcast Message
Admin
↓
Compose Broadcast
↓
Send
↓
All Users Receive

الرسالة:

One Way

ولا يستطيع المستخدم الرد عليها.

5.21 Subscription
UC-031 — Manage Subscription

Actor: Admin

الـAdmin يستطيع تحديد:

Start Date
End Date

للمؤسسة.

ويستطيع:

Activate
Renew
Update
Expire
Manage subscription status
5.22 Approval System

كل Approval Request تقريبًا يجب أن يمر عبر نموذج موحد:

Create
↓
Pending
↓
Review
├── Approve
└── Reject

لكن الـApprover يعتمد على الـDomain.

مثلاً:

Veterinarian Registration
↓
Admin

Clinic
↓
Admin / Assigned Supervisor

Lost Animal
↓
Animal Supervisor / Admin

Consultation
↓
Consultation Supervisor / Admin
5.23 Admin Override

الـAdmin يستطيع التدخل في العمليات التي يديرها الـSupervisors.

مثلاً:

Animal Supervisor
↓
Approve / Reject

لكن:

Admin
↓
Can Override

وكذلك يستطيع الـAdmin:

Remove members
Suspend users
Modify organizations
Change Supervisors
Change permissions
5.24 Main Business Workflow

الصورة العامة للنظام:

                    ┌──────────────┐
                    │     User     │
                    └──────┬───────┘
                           │
             ┌─────────────┴─────────────┐
             │                           │
       Pet Owner                    Veterinarian
             │                           │
             │                     Approval Required
             │                           │
             │                    ┌──────┴──────┐
             │                    │             │
             │                 Clinic         Farm
             │                    │             │
             │              Medical Records   Farm Data
             │
      ┌──────┼────────┐
      │      │        │
    Lost  Adoption  Mating
      │      │        │
      └──────┼────────┘
             │
          Approval

5.25 أهم قاعدة في الـUse Cases

كل Use Case سنكتبه لاحقًا بالتفصيل يجب أن يحتوي على:

Use Case ID
Actor
Goal
Preconditions
Main Flow
Alternative Flows
Business Rules
Permissions
Approval Requirements
Result
Notifications

مثال:

UC-012 — Assign Veterinarian to Clinic

Actor:
Clinic Owner

Preconditions:

- User is an approved Veterinarian.
- Current user is Clinic Owner.
- Clinic is Active.

Main Flow:

1. Owner opens Clinic.
2. Owner selects Veterinarian.
3. Owner assigns Veterinarian.
4. System creates membership.
5. Veterinarian becomes a Clinic member.

Business Rules:

- Veterinarian approval is required.
- Veterinarian does not need to accept assignment.
- Veterinarian can leave the Clinic later.
- Admin can remove the membership.

Result:
Veterinarian becomes a member of the Clinic.
