# 01 — System Scope & Vision

## 1.1 System Name

**Veterinary Platform**

> الاسم التجاري النهائي للنظام يتم تحديده لاحقًا.

---

## 1.2 System Vision

النظام عبارة عن منصة بيطرية موحدة تهدف إلى إدارة الخدمات والعمليات المتعلقة بالحيوانات، والأطباء البيطريين، والعيادات، والمزارع، والمكاتب والمتاجر البيطرية، والنقابات، بالإضافة إلى توفير وسائل التواصل والاستشارات وإدارة النظام من خلال الإدارة والمشرفين المختصين.

يعتمد النظام على **Backend مركزي** وتطبيق **Mobile واحد لجميع المستخدمين**.

يمكن للمستخدم أن يمتلك أكثر من Role أو Context داخل النظام. فعلى سبيل المثال، يمكن للمستخدم أن يكون **Pet Owner وVeterinarian في نفس الوقت**، ويمكنه التبديل بين واجهة صاحب الحيوان وواجهة الطبيب البيطري من داخل الشاشة الرئيسية.

كما يمكن للمستخدمين الذين يمتلكون صلاحيات إدارية، مثل Admin أو Supervisors المعينين من قبل Admin، الوصول إلى **Control Panel** داخل نفس تطبيق الموبايل لإدارة الأجزاء التي تسمح لهم بها صلاحياتهم.

---

# 1.3 System Objectives

## 1. إدارة المستخدمين

توفير نظام موحد للمستخدمين مع دعم الأدوار الأساسية:

- Pet Owner
- Veterinarian
- Admin
- Moderator

مع إمكانية امتلاك المستخدم لأكثر من Role أو Context عند الحاجة.

---

## 2. إدارة الحيوانات

تمكين صاحب الحيوان من:

- إضافة الحيوانات التي يملكها.
- إدارة بيانات حيواناته.
- نقل ملكية الحيوان إلى مستخدم آخر داخل النظام.
- نشر الحيوان للتبني.
- نشر الحيوان للتزاوج.
- الإبلاغ عن الحيوان كمفقود.

إضافة الحيوان الذي يملكه المستخدم إلى حسابه لا تحتاج إلى موافقة إدارية.

أما عمليات نشر الحيوان في حالات:

- Lost
- Adoption
- Mating

فتحتاج إلى Approval من Admin أو Supervisor مختص.

---

## 3. الرعاية والسجلات البيطرية

تمكين الطبيب البيطري المعين في العيادة من:

- الوصول إلى بيانات الحيوان.
- قراءة السجل الطبي.
- إنشاء السجلات الطبية.
- تعديل السجلات الطبية.
- حذف السجلات الطبية.
- إضافة التطعيمات.
- إدارة البيانات البيطرية المرتبطة بالحيوان.

ويستطيع الطبيب المعين في العيادة الوصول إلى السجل الطبي الكامل للحيوان دون الحاجة إلى موافقة صاحب الحيوان على كل عملية طبية.

---

## 4. إدارة المؤسسات

يدعم النظام عدة أنواع من المؤسسات والكيانات، من بينها:

- Clinics
- Veterinary Offices
- Pet Owner Stores
- Veterinary Stores
- Poultry Farms
- Syndicates
- Hospitals

وتختلف العمليات والصلاحيات حسب نوع المؤسسة.

تخضع المؤسسات التي تتطلب اعتمادًا إلى Approval Workflow قبل تفعيلها في النظام.

---

## 5. إدارة العيادات

تمكين الطبيب البيطري المعتمد من:

- إنشاء عيادة.
- إدارة بيانات العيادة.
- تعيين الأطباء.
- تعيين أكثر من Supervisor.
- تحديد صلاحيات المشرفين التابعين للعيادة.
- إدارة أعضاء العيادة.
- التواصل مع أصحاب الحيوانات.

يجب أن يكون Clinic Owner طبيبًا بيطريًا معتمدًا.

---

## 6. إدارة المزارع

يدعم النظام حاليًا نظام **Poultry Farms**.

أما مزارع الأبقار والأغنام فهي ضمن النطاق المستقبلي، وسيتم تحليل عملياتها وبياناتها لاحقًا بعد تحديد المتطلبات الخاصة بها.

تتكون المزرعة من:

- Owner
- Supervisors
- Veterinarians
- Employees

ويجب أن يكون Farm Owner طبيبًا بيطريًا معتمدًا.

يمكن للطبيب البيطري الانضمام إلى المزرعة باستخدام **Farm ID** يتم إعطاؤه له من صاحب المزرعة.

بمجرد إدخال Farm ID، يصبح الطبيب عضوًا في المزرعة مباشرة دون الحاجة إلى Invitation Acceptance أو Approval.

---

## 7. إدارة المكاتب والمتاجر

يدعم النظام نوعين مختلفين من المتاجر:

### Pet Owner Store

متجر موجه لأصحاب الحيوانات لعرض وبيع منتجات مثل:

- الأغذية.
- الأعلاف.
- مستلزمات الحيوانات.
- المنتجات المتعلقة بالحيوانات.

### Veterinary Store

متجر موجه للأطباء البيطريين لعرض منتجات مثل:

- الأدوية.
- الأجهزة الطبية.
- المستلزمات البيطرية.

ويعتبر **Veterinary Office** كيانًا مستقلًا عن المتاجر.

يمكن للمكاتب والمتاجر أن يكون لها:

- Owner
- Supervisors
- Staff

---

## 8. الاشتراكات

تخضع الكيانات التالية لنظام الاشتراكات:

- Clinics
- Veterinary Offices
- Pet Owner Stores
- Veterinary Stores
- Farms

ولا تخضع الكيانات التالية للاشتراك:

- Hospitals
- Syndicates

لا يعتمد النظام حاليًا على Subscription Plans متعددة.

يقوم الـAdmin بتحديد فترة الاشتراك لكل مؤسسة من خلال:

- Subscription Start Date
- Subscription End Date

ويتحكم الـAdmin في عمليات تجديد الاشتراك.

---

## 9. التواصل والمحادثات

يوفر النظام Chat حسب طبيعة العلاقة بين المستخدمين والمؤسسات.

### Clinic Chat

يمكن لصاحب الحيوان التواصل مع العيادة، ويمكن للعيادة التواصل مع صاحب الحيوان.

```text
Pet Owner ↔ Clinic
Farm Chat

يمكن لصاحب المزرعة التواصل مع:

Veterinarians
Employees
Farm Owner ↔ Veterinarian
Farm Owner ↔ Employee

ولا يسمح نظام Farm Chat بتواصل عام بين جميع أعضاء المزرعة.

10. الاستشارات والاستفسارات

يوفر النظام نوعين من العمليات:

Consultation

يستخدمها صاحب الحيوان لطرح استشارة.

Pet Owner → Consultation

ولا يشترط أن تكون الاستشارة مرتبطة بحيوان محدد.

يمكن أن يتم التعامل معها بواسطة:

AI
Admin
Consultation Supervisor
Inquiry

يستخدمها الطبيب البيطري لطرح استفسار عام.

Veterinarian → Inquiry

ويتم التعامل معها بواسطة:

AI
Admin
Inquiry Supervisor
11. الذكاء الاصطناعي

يمكن للـAdmin التحكم في إعدادات الذكاء الاصطناعي الخاصة بالاستشارات والاستفسارات.

إذا كان AI مفعلاً، يقوم بالرد تلقائيًا عند إنشاء Consultation أو Inquiry.

Consultation / Inquiry
        ↓
    AI Response

يمكن للـAdmin أو الـSupervisor:

الرد على الـThread.
متابعة الحوار.
التدخل في المحادثة.
إيقاف إرسال رسائل إضافية من المستخدم الذي أنشأ الـThread.

عند إيقاف الإرسال يصبح الـThread بالنسبة للمرسل في حالة Read Only.

12. النقابات

يدعم النظام النقابات البيطرية، وتشمل وظائفها الأساسية:

إدارة النقابة.
إدارة المشرفين.
نشر الإعلانات.
إدارة المحتوى المرتبط بالنقابة.

النقابات لا تخضع لنظام الاشتراكات الحالي.

13. إدارة النظام

يمتلك الـAdmin صلاحية كاملة على النظام.

تشمل صلاحياته العامة:

إدارة المستخدمين.
إدارة المؤسسات.
الموافقة على الطلبات.
تعديل البيانات.
حذف البيانات.
إيقاف المستخدمين.
إيقاف المؤسسات.
إدارة الاشتراكات.
تعيين المشرفين.
تغيير المشرفين.
إدارة الصلاحيات.
إدارة الاستشارات والاستفسارات.
إدارة المحتوى.
إدارة الرسائل.
إدارة إعدادات AI.

ويستطيع الـAdmin التدخل في وإدارة أي جزء من النظام.

1.4 Approval Principle

يعتمد النظام على مبدأ الموافقات للكيانات والعمليات التي تحتاج إلى اعتماد.

الشكل العام:

User / Organization
        ↓
Create Request
        ↓
Pending
        ↓
Admin / Authorized Supervisor
        ↓
Approved / Rejected
        ↓
Active

أمثلة على الكيانات التي تحتاج إلى موافقة قبل التفعيل:

Veterinarian Registration
Clinics
Veterinary Offices
Stores
Farms
وغيرها حسب قواعد النظام.

أما إضافة صاحب الحيوان لحيوان يملكه شخصيًا فلا تحتاج إلى موافقة.

بينما:

Lost
Adoption
Mating

تحتاج إلى موافقة Admin أو Supervisor مختص.

1.5 Supervisor Model

يوجد مفهوم موحد للـSupervisor، ولكن يختلف الـScope حسب طريقة تعيينه.

System Supervisors

يتم تعيينهم بواسطة الـAdmin للعمل على مستوى النظام أو Domain معين.

أمثلة:

Clinic Supervisor
Veterinary Office Supervisor
Store Supervisor
Animal Supervisor
Content Supervisor
Consultation Supervisor
Inquiry Supervisor
وغيرها.

الـAdmin يستطيع:

تعيين Supervisor.
تحديد الـScope.
تحديد الصلاحيات.
تغيير Supervisor.
إزالة Supervisor.
Organization Supervisors

يتم تعيينهم بواسطة Owner المؤسسة.

هؤلاء الأشخاص يكونون أطباء بيطريين مسجلين في النظام، ويتم تعيينهم للإشراف داخل المؤسسة.

يمكن للـOwner:

تعيين أكثر من Supervisor.
تحديد صلاحياتهم.
إزالة Supervisor.

ويستطيع الـAdmin التدخل وإدارة هذه التعيينات أيضًا.

1.6 Target Applications

يتكون النظام من:

Veterinary System
│
├── Backend
│
└── Mobile Application
      │
      ├── Pet Owner Interface
      │
      ├── Veterinarian Interface
      │
      └── Control Panel
            │
            ├── Admin
            └── Authorized Supervisors
Mobile Application

يوجد تطبيق Mobile واحد لجميع المستخدمين.

يشمل:

Pet Owners
Veterinarians
Organization Owners
Organization Supervisors
Admins
System Supervisors

ويتم تحديد الواجهات والوظائف المتاحة للمستخدم بناءً على:

Role
Organization Membership
Supervisor Scope
Permissions
Pet Owner Interface

واجهة مخصصة لوظائف صاحب الحيوان، مثل:

إدارة الحيوانات.
Lost Animals.
Adoption.
Mating.
Consultations.
Chat.
المتاجر.
وغيرها من الوظائف المسموح بها.
Veterinarian Interface

واجهة مخصصة لوظائف الطبيب البيطري، مثل:

الحيوانات التي يستطيع الوصول إليها.
Medical Records.
Vaccinations.
Clinics.
Farms.
Inquiries.
المؤسسات التي يعمل بها.
وغيرها من الوظائف المسموح بها.

يمكن للمستخدم الذي يمتلك صلاحية Veterinarian التبديل بين:

Pet Owner Mode
      ↕
Veterinarian Mode

من الشاشة الرئيسية.

Control Panel

الـControl Panel ليست تطبيقًا منفصلًا.

هي Module داخل تطبيق الـMobile App، ولا تظهر إلا للمستخدمين الذين لديهم صلاحية إدارية.

مثال:

Admin
└── Control Panel
    ├── Users
    ├── Organizations
    ├── Approvals
    ├── Subscriptions
    ├── Supervisors
    ├── Consultations
    ├── Inquiries
    ├── Content
    └── System Settings

بينما Supervisor محدود الصلاحيات يرى فقط الأقسام المرتبطة بالـScope والPermissions الخاصة به.

1.7 System Boundaries
Included in Current Scope
Users
Authentication
Roles
Permissions
Animals
Animal Ownership
Medical Records
Vaccinations
Clinics
Veterinary Offices
Pet Owner Stores
Veterinary Stores
Poultry Farms
Syndicates
Subscriptions
Chat
Consultations
Inquiries
AI
Approvals
Notifications
Admin Messaging
Administration
Supervisors
Future Scope
Cattle Farms

سيتم تحليل عمليات وبيانات مزارع الأبقار لاحقًا.

Sheep Farms

سيتم تحليل عمليات وبيانات مزارع الأغنام لاحقًا.

لا يتم افتراض أن عملياتها مطابقة لعمليات Poultry Farms.

1.8 Legacy System Scope

قاعدة البيانات والمشروع القديم يحتويان على Features إضافية.

لن يتم اعتبار جميع الـFeatures الموجودة في الـLegacy System جزءًا من النظام الجديد تلقائيًا.

سيتم تحليل كل Feature وتصنيفها إلى:

KEEP
REMOVE
LATER

ويتم اعتماد النتيجة كجزء من الـFinal System Requirements.

1.9 Core Authorization Principle

يجب عدم الاعتماد على الـRole وحده لتحديد صلاحيات المستخدم.

الوصول إلى أي وظيفة يعتمد على مجموعة من العوامل:

User
  +
Role
  +
Organization Membership
  +
Supervisor Scope
  +
Permissions

مثال:

Veterinarian
│
├── Clinic A
│    └── Supervisor
│         └── Permissions
│
├── Clinic B
│    └── Veterinarian
│
└── Farm C
     └── Veterinarian

وبالتالي يمكن لنفس المستخدم أن يمتلك صلاحيات مختلفة حسب المؤسسة أو الـScope الذي يعمل داخله.

1.10 Scope Exclusions / Decisions

في النسخة الحالية:

لا يوجد Web Application للمستخدمين العاديين.
لا يوجد Admin Web Application منفصل.
الـAdmin يستخدم نفس Mobile Application.
الـControl Panel موجود داخل تطبيق Mobile.
Cattle Farm Operations مؤجلة.
Sheep Farm Operations مؤجلة.
Subscription Plans المتعددة غير موجودة حاليًا.
Hospitals لا تخضع للاشتراك.
Syndicates لا تخضع للاشتراك.
كل Features الموجودة في الـLegacy Schema لا تعتبر جزءًا من النظام الجديد إلا بعد اعتمادها.
```
