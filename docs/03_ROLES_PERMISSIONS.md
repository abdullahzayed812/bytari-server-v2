03 — Roles, Permissions & Authorization

قبل ما نعتمد البند، هنحلله مع بعض ونثبت القواعد.

3.1 Base Roles

حسب الاتفاق الحالي، عندنا 4 أدوار أساسية:

Admin
Moderator
Pet Owner
Veterinarian
Admin

يمتلك:

Full System Access

ويستطيع إدارة جميع أجزاء النظام، بما فيها المستخدمين والمؤسسات والموافقات والمشرفين والصلاحيات.

Pet Owner

يمتلك صلاحيات وظائف صاحب الحيوان، مثل:

إدارة الحيوانات التي يملكها.
إنشاء Consultations.
استخدام Pet Owner Chat.
نشر Lost / Adoption / Mating من خلال الـApproval Workflow.
استخدام الخدمات المتاحة لأصحاب الحيوانات.
Veterinarian

يمتلك وظائف الطبيب بعد اعتماد الحساب، مثل:

الوصول إلى الحيوانات المسموح بها.
إدارة Medical Records حسب الـPermissions.
إدارة Vaccinations.
إنشاء Inquiries.
العمل في Clinics.
العمل في Farms.
العمل في المؤسسات الأخرى حسب الـMembership.

والـVeterinarian يستطيع أيضًا استخدام Pet Owner Mode.

Moderator

الـModerator هو Role إداري/إشرافي عام، لكن لا نعطيه صلاحيات ثابتة تلقائيًا.

صلاحياته تعتمد على:

Moderator

- Assigned Scope
- Permissions
  3.2 Supervisor Concept

الـSupervisor ليس بالضرورة Base Role مستقل.

لدينا نوعان من الـSupervisor:

System Supervisor

يتم تعيينه بواسطة Admin.

مثلاً:

Animal Supervisor
Clinic Supervisor
Store Supervisor
Consultation Supervisor
Inquiry Supervisor
Content Supervisor
Organization Supervisor

يتم تعيينه بواسطة Organization Owner.

ويجب أن يكون:

Approved Veterinarian

مثلاً:

Clinic A
│
├── Owner
├── Supervisor → Veterinarian #1
├── Supervisor → Veterinarian #2
└── Veterinarians
3.3 Permission Model

الصلاحيات يجب أن تكون Atomic Permissions قدر الإمكان.

بدل:

Clinic Manager

نستخدم صلاحيات مثل:

clinic.read
clinic.update
clinic.delete
clinic.members.read
clinic.members.add
clinic.members.remove
clinic.supervisors.assign
clinic.supervisors.remove

وبذلك يستطيع الـAdmin بناء أدوار وصلاحيات مرنة.

3.4 Permission Structure

مبدئيًا نستخدم:

resource.action

مثلاً:

animal.read
animal.create
animal.update
animal.delete

أو:

medical_record.read
medical_record.create
medical_record.update
medical_record.delete

أو:

clinic.read
clinic.create
clinic.update
clinic.delete
3.5 Scope

الـPermission وحدها غير كافية.

مثلاً:

medical_record.read

لا تعني أن الطبيب يستطيع قراءة كل السجلات الموجودة في النظام.

قد يكون Scope الطبيب:

Clinic A

فيصبح:

medical_record.read

- Clinic A

أي:

يستطيع قراءة السجلات التي تقع ضمن نطاق Clinic A.

3.6 Organization Scope

مثال:

Veterinarian A
│
├── Clinic A
│ └── Supervisor
│ ├── medical_record.read
│ ├── medical_record.create
│ └── medical_record.update
│
├── Clinic B
│ └── Veterinarian
│ └── medical_record.read
│
└── Farm A
└── Veterinarian

نفس الشخص، لكن صلاحياته تختلف حسب الـOrganization.

3.7 Permission Assignment

لدينا أكثر من مصدر للصلاحيات:

User
↓
Base Role
↓
Organization Membership
↓
Supervisor Assignment
↓
Permissions
↓
Effective Access

مثلاً:

User
Role: Veterinarian

Clinic A
Membership: Supervisor
Permissions:
medical_record.read
medical_record.create
medical_record.update

Clinic B
Membership: Veterinarian
Permissions:
medical_record.read
3.8 Organization Owner Permissions

الـOwner له صلاحيات إدارة مؤسسته.

مثلاً Clinic Owner يستطيع:

إدارة بيانات العيادة.
إضافة Veterinarians.
إزالة Veterinarians.
تعيين Supervisors.
إزالة Supervisors.
تحديد صلاحيات Supervisors.

لكن Owner لا يتجاوز صلاحيات الـAdmin.

Admin
↓
Full System Authority

Organization Owner
↓
Organization-Level Authority
3.9 Organization Supervisor Permissions

الـOwner يستطيع تعيين Supervisor وإعطائه مجموعة من الصلاحيات.

مثلاً:

Clinic Supervisor
├── clinic.read
├── members.read
├── medical_record.read
└── medical_record.create

بينما Supervisor آخر:

Clinic Supervisor
├── clinic.read
├── members.read
└── members.remove

إذن ليس كل Supervisors لديهم نفس الصلاحيات.

3.10 System Supervisor Permissions

الـAdmin يستطيع إنشاء Domain Supervisor وتحديد:

Domain

- Permissions

مثلاً:

Animal Supervisor

Scope:
Animal Management

Permissions:
animal.read
animal.update
animal.approve
animal.reject

ومثال آخر:

Consultation Supervisor

Scope:
Consultations

Permissions:
consultation.read
consultation.reply
consultation.close
consultation.block_sender
3.11 Admin Authorization

Admin لديه:

Full System Access

ولا يعتمد على Organization Membership للوصول إلى النظام.

يمكنه الوصول إلى جميع المؤسسات والمستخدمين والبيانات وفق سياسات النظام.

ويستطيع كذلك:

تجاوز Organization-level permissions.
إزالة أي عضو من مؤسسة.
تعديل أي مؤسسة.
إيقاف أي مستخدم.
تغيير أي Supervisor.
تغيير الصلاحيات.
3.12 Authorization Decision

عند محاولة المستخدم تنفيذ Action:

User
↓
Authentication
↓
Identify Role
↓
Identify Organization Context
↓
Identify Scope
↓
Check Permission
↓
Allow / Deny

مثال:

Veterinarian
↓
Clinic A
↓
Supervisor
↓
medical_record.update
↓
Allowed

بينما:

Veterinarian
↓
Clinic B
↓
No update permission
↓
medical_record.update
↓
Denied
3.13 Important Rule — Role ≠ Permission

لا يجب أن يكون:

Veterinarian = Full Veterinarian Permissions

ولا:

Supervisor = Full Organization Permissions

بل:

Role

- Membership
- Scope
- Permissions

هي التي تحدد الـEffective Access.

3.14 Important Rule — Owner ≠ Admin

حتى لو كان المستخدم Owner لمؤسسة:

Clinic Owner
Veterinary Office Owner
Store Owner
Farm Owner

فهو لا يصبح Admin.

صلاحياته تكون داخل المؤسسة التي يمتلكها فقط.

3.15 Important Rule — Veterinarian Can Have Multiple Contexts

مثال واقعي:

Abdullah
│
├── Pet Owner
│
├── Veterinarian
│
├── Clinic A
│ └── Owner
│
├── Clinic B
│ └── Supervisor
│
└── Farm C
└── Veterinarian

وبالتالي التطبيق يجب أن يعرف Current Context الذي يعمل فيه المستخدم، خصوصًا عندما تكون الصلاحيات مختلفة بين المؤسسات.

Permission Assignment

الـOwner لا ينشئ Permissions جديدة، وإنما يختار من قائمة Permissions معرفة مسبقًا في النظام.

مثال:

Assign Supervisor
│
├── Members
│ ├── ✓ View Members
│ ├── ✓ Add Members
│ └── ✓ Remove Members
│
├── Medical Records
│ ├── ✓ View
│ ├── ✓ Create
│ ├── ✓ Update
│ └── ✗ Delete
│
└── Clinic
├── ✓ View
└── ✗ Update

وبالتالي:

System-defined Permissions
↓
Organization Owner
↓
Select Permissions
↓
Supervisor
Admin Supervisor Management

الـAdmin عنده صفحة/قسم مخصص لإدارة Supervisors يستطيع من خلاله:

عرض جميع المستخدمين في النظام.
اختيار أي مستخدم مؤهل.
تعيينه كـSupervisor.
تحديد الـDomain/Section الذي سيشرف عليه.
تحديد الـPermissions الخاصة به.
تغيير الـSupervisor المسؤول لاحقًا.
إزالة الـSupervisor.
تعديل صلاحياته.

مثال:

Admin
│
└── Supervisor Management
│
├── Select User
│
├── Select Domain
│ └── Consultations
│
├── Assign Permissions
│ ├── consultation.read
│ ├── consultation.reply
│ ├── consultation.close
│ └── consultation.block_sender
│
└── Activate Assignment

وهنا مهم نفرق بين:

System Supervisor

يعينه الـAdmin على مستوى النظام/Domain.

و:

Organization Supervisor

يعينه الـOwner داخل مؤسسته، من قائمة الـVeterinarians الموجودين في النظام.
