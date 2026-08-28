04 — Functional Modules & Features
4.1 Authentication & Account Management

مسؤول عن:

Registration
Login / Logout
Password Management
Account Verification
User Profile
Veterinarian Registration
Veterinarian Approval
Account Status
Role Management
User Activation / Suspension
4.2 User & Role Management

إدارة:

Users
Roles
Permissions
User Status
Role Assignment
Supervisor Assignment
Organization Memberships

ويجب أن يدعم المستخدم أكثر من Context.

مثال:

User
├── Pet Owner
└── Veterinarian
4.3 Pet & Animal Management

مسؤول عن:

إضافة الحيوانات.
تعديل بيانات الحيوان.
عرض الحيوان.
حذف الحيوان.
ملكية الحيوان.
نقل الملكية.
ربط الحيوان بصاحب الحيوان.
Animal Profile.
Special Animal Processes
Lost Animals
Adoption
Mating

هذه العمليات لها Approval Workflow.

4.4 Medical Records

مسؤول عن السجلات الطبية للحيوانات.

يشمل:

Medical Records
Medical History
Diagnoses
Treatments
Notes
Vaccinations
Medical Attachments

الـVeterinarian المرتبط بالعيادة يستطيع إدارة السجل حسب صلاحياته.

4.5 Vaccination Management

مسؤول عن:

Vaccination Records
Vaccination Dates
Vaccination Details
Vaccination History
Future/Upcoming Vaccinations
4.6 Clinic Management

يشمل:

Create Clinic
Clinic Approval
Clinic Profile
Clinic Owner
Clinic Supervisors
Clinic Veterinarians
Clinic Memberships
Assign Veterinarian
Remove Veterinarian
Leave Clinic
Clinic Permissions
Clinic Subscription
Clinic Status
4.7 Veterinary Office Management

يشمل:

Create Veterinary Office
Approval
Office Profile
Owner
Supervisors
Staff
Membership Management
Permissions
Subscription
Status
4.8 Pet Owner Store

مسؤول عن متجر المنتجات الموجهة لأصحاب الحيوانات.

يشمل مبدئيًا:

Store
Products
Categories
Product Details
Inventory
Orders
Purchasing
Store Memberships
Subscription
4.9 Veterinary Store

متجر منفصل موجه للأطباء البيطريين.

يشمل مبدئيًا:

Store
Veterinary Products
Medicines
Medical Equipment
Categories
Inventory
Orders
Purchasing
Staff / Supervisors
Subscription
4.10 Farm Management

النطاق الحالي:

Poultry Farms

يشمل:

Farm Creation
Farm Approval
Farm Profile
Farm Owner
Supervisors
Veterinarians
Employees
Farm Memberships
Farm Permissions
Farm ID
Farm Subscription
Farm Data
Poultry Operations
Deferred
Cattle Farms
Sheep Farms

سيتم تحليل العمليات الخاصة بهم لاحقًا بدل افتراض أنها نفس نظام Poultry Farms.

4.11 Organization Membership

Module مشترك لإدارة علاقة المستخدم بالمؤسسة.

يشمل:

Membership
Membership Type
Organization Role
Supervisor Assignment
Permission Assignment
Join Organization
Leave Organization
Remove Member
Membership Status

مثال:

Veterinarian
↓
Clinic A
↓
Supervisor
↓
Permissions
4.12 Subscription Management

يشمل:

Subscription Creation
Start Date
End Date
Active / Expired Status
Renewal
Subscription Approval
Subscription Management

والـAdmin هو المسؤول عن إدارة وتجديد الاشتراكات.

4.13 Syndicate Management

يشمل:

Syndicates
Syndicate Profile
Syndicate Supervisors
Announcements
Syndicate Content

ولا يوجد Subscription حاليًا للنقابات.

4.14 Lost / Adoption / Mating

Module خاص بالعمليات التي تتطلب Moderation.

Lost Animals
Pet Owner
↓
Create Lost Animal
↓
Pending
↓
Admin / Supervisor
↓
Approved / Rejected
Adoption

نفس المبدأ.

Mating

نفس المبدأ.

4.15 Chat & Messaging

يشمل نظام المحادثات بين المستخدمين والمؤسسات.

Clinic Chat
Pet Owner ↔ Clinic
Farm Chat
Farm Owner ↔ Veterinarian
Farm Owner ↔ Employee

ويجب أن يكون الـChat مرتبطًا بالـAuthorization والـMembership.

4.16 Consultations

يستطيع Pet Owner إنشاء Consultation.

خصائص أساسية:

General Consultation
No Animal Required
AI Response
Human Response
Consultation Supervisor
Admin Intervention
Close Consultation
Block Sender
4.17 Inquiries

يستطيع Veterinarian إنشاء Inquiry.

خصائص أساسية:

General Inquiry
No Animal Required
AI Response
Human Response
Inquiry Supervisor
Admin Intervention
Close Inquiry
Block Sender
4.18 AI Management

مسؤول عن AI داخل Consultations وInquiries.

يشمل:

AI Enable / Disable
Automatic AI Response
AI Configuration
AI Conversation Handling
Human Intervention
Sender Blocking

الـAdmin يتحكم في تفعيل AI.

4.19 Notification System

مسؤول عن الإشعارات الناتجة عن أحداث النظام.

أمثلة:

Veterinarian Approved
Clinic Approved
Supervisor Assigned
New Message
New Consultation
New Inquiry
Subscription Expiring
Animal Approved
Announcement Published

سنحدد القائمة النهائية للـNotifications بعد الانتهاء من الـUse Cases حتى لا ننشئ Notifications غير ضرورية.

4.20 Admin Messaging & Broadcast

الـAdmin يستطيع إرسال:

Individual Message
Admin → User
Group Message
Admin → Selected User Category

مثل:

All Veterinarians
All Pet Owners
All Supervisors
Broadcast
Admin → Everyone

والـBroadcast:

One Way

ولا يسمح للمستلمين بالرد.

4.21 Approval & Moderation

Module مركزي لإدارة كل الـApproval Workflows.

يشمل:

Approval Requests
Pending Requests
Approve
Reject
Suspend
Restore
Assign Responsible Supervisor
Moderation

ويستخدم مع:

Veterinarians
Clinics
Veterinary Offices
Stores
Farms
Lost Animals
Adoption
Mating
وأي موارد أخرى تحتاج موافقة.
4.22 Admin Control Panel

Control Panel داخل نفس Mobile Application.

يشمل Modules حسب صلاحيات المستخدم:

Admin
│
├── Users
├── Roles
├── Permissions
├── Supervisors
├── Organizations
├── Approvals
├── Subscriptions
├── Animals
├── Content
├── Consultations
├── Inquiries
├── Messages
├── Notifications
├── AI
└── System Settings

أما الـSupervisor فيرى فقط الـModules المرتبطة بالـScope والـPermissions الخاصة به.

4.23 Content Management

Module مسؤول عن المحتوى الذي يتم نشره داخل النظام، مثل:

Syndicate Announcements
Books
Magazines
Educational Content
Other Moderated Content

الـBooks والـMagazines موجودة ضمن الـScope الأصلي للمشروع، لكن تفاصيل الـWorkflow الخاص بها سنحددها لاحقًا.

4.24 System Settings

إعدادات النظام العامة، مثل:

AI Settings
System Configuration
Notification Settings
Approval Settings
Other Global Settings

صلاحية تعديلها تكون للـAdmin فقط إلا إذا حددنا خلاف ذلك لاحقًا.

4.25 Module Map

الصورة الكبيرة للنظام حاليًا:

Veterinary Platform
│
├── Authentication
├── Users & Roles
├── Permissions
│
├── Animals
│ ├── Ownership
│ ├── Lost
│ ├── Adoption
│ └── Mating
│
├── Veterinary Care
│ ├── Medical Records
│ └── Vaccinations
│
├── Organizations
│ ├── Clinics
│ ├── Veterinary Offices
│ ├── Pet Owner Stores
│ ├── Veterinary Stores
│ ├── Poultry Farms
│ ├── Syndicates
│ └── Hospitals
│
├── Memberships
├── Subscriptions
│
├── Communication
│ ├── Chat
│ ├── Consultations
│ ├── Inquiries
│ └── Admin Messaging
│
├── AI
├── Notifications
│
├── Approval & Moderation
├── Content
│
└── Administration
├── Control Panel
├── Users
├── Supervisors
├── Permissions
└── System Settings
