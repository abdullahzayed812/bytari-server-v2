02 — Actors & Organizations

الهدف من البند ده إننا نحدد مين موجود في النظام، وما هي الكيانات/المؤسسات الموجودة، والعلاقات الأساسية بينهم.

مش هندخل لسه في تفاصيل الـPermissions؛ دي هنفصلها في بند مستقل.

2.1 System Actors

1. Pet Owner

مستخدم يستطيع:

إضافة الحيوانات التي يملكها.
إدارة حيواناته.
نقل ملكية الحيوان.
إنشاء Consultations.
استخدام Chat المتاح له.
التفاعل مع المتاجر والخدمات المتاحة.
نشر الحيوانات للتبني أو التزاوج أو كمفقودة بعد المرور بعملية الموافقة. 2. Veterinarian

المستخدم المسجل كطبيب بيطري يستطيع، بعد الاعتماد:

استخدام Veterinarian Interface.
العمل في أكثر من Clinic.
العمل في أكثر من Farm.
الانضمام إلى Farm باستخدام Farm ID.
الوصول إلى الحيوانات والسجلات التي يسمح له بها ارتباطه بالمؤسسة.
إدارة Medical Records حسب صلاحياته.
إنشاء Inquiries.
العمل كـOrganization Supervisor عند تعيينه من Owner.

يمكن للطبيب استخدام Pet Owner Interface أيضًا.

قبل اعتماد الطبيب، يستطيع استخدام النظام كـPet Owner، ولا يحصل على صلاحيات Veterinarian إلا بعد الموافقة.

3. Admin

يمثل أعلى مستوى إداري في النظام.

الـAdmin لديه Full System Access ويمكنه:

إدارة المستخدمين.
إدارة المؤسسات.
إدارة الموافقات.
إدارة الاشتراكات.
إدارة المشرفين.
إدارة الصلاحيات.
إدارة المحتوى.
إدارة الاستشارات والاستفسارات.
إدارة الرسائل.
التحكم في AI.
إدارة وإيقاف وحذف موارد النظام.
التدخل في عمليات المؤسسات والمستخدمين. 4. Moderator

الـModerator هو Role أساسي في النظام، لكن طبيعة عمله وScope وصلاحياته تحتاج أن تُحدد من خلال نظام الـPermissions والـSupervisor Assignments.

لا نفترض حاليًا أن كل Moderator لديه نفس الصلاحيات.

2.2 Supervisor Actors

الـSupervisor ليس مجرد نوع مستخدم مستقل عن الـVeterinarian؛ لدينا سياقان:

System / Domain Supervisor

يتم تعيينه بواسطة Admin للعمل على Domain معين.

أمثلة:

Animal Supervisor
Clinic Supervisor
Veterinary Office Supervisor
Store Supervisor
Consultation Supervisor
Inquiry Supervisor
Content Supervisor
Organization Supervisor

يتم تعيينه بواسطة Organization Owner.

ويجب أن يكون الشخص Veterinarian مسجلًا في النظام.

مثال:

Clinic
├── Owner
├── Supervisor
├── Supervisor
└── Veterinarians

نفس الطبيب يمكن أن يكون:

Clinic A → Organization Supervisor
Clinic B → Veterinarian
Farm C → Veterinarian

وبالتالي الـSupervisor Scope مرتبط بالسياق الذي تم تعيينه فيه.

2.3 Organization Types

1. Clinic

العيادة مؤسسة بيطرية يديرها Veterinarian Owner.

يمكن أن تحتوي على:

Clinic
├── Owner
├── Supervisors
└── Veterinarians

وتتعامل مع Pet Owners والحيوانات والسجلات الطبية.

2. Veterinary Office

مؤسسة مستقلة عن Clinic والمتاجر.

يمكن أن تحتوي على:

Veterinary Office
├── Owner
├── Supervisors
└── Staff 3. Pet Owner Store

متجر موجه لأصحاب الحيوانات.

يعرض منتجات مثل:

Food
Feed
Pet Supplies
Animal-related Products 4. Veterinary Store

متجر موجه للأطباء البيطريين.

يعرض منتجات مثل:

Veterinary Medicines
Medical Equipment
Veterinary Supplies

وهو كيان مستقل عن Pet Owner Store.

5. Poultry Farm

مزرعة دواجن.

يمكن أن تحتوي على:

Poultry Farm
├── Owner
├── Supervisors
├── Veterinarians
└── Employees

الـOwner يجب أن يكون Veterinarian معتمدًا.

6. Syndicate

كيان يمثل النقابة البيطرية.

يحتوي على:

Syndicate management
Supervisors
Announcements
Syndicate content

ولا يحتاج إلى Subscription.

7. Hospital

Hospital موجود ضمن أنواع المؤسسات المدعومة في النظام، لكنه حاليًا:

لا يحتاج Subscription.
تفاصيل العمليات الداخلية لم يتم تحديدها بعد.

لذلك لا نفترض حاليًا Structure أو Workflows إضافية له قبل تحليلها.

2.4 Organization Ownership

المؤسسات التي لها Owner:

Organization Owner
Clinic Veterinarian
Veterinary Office Owner
Pet Owner Store Owner
Veterinary Store Owner
Poultry Farm Veterinarian

بالنسبة لـSyndicate وHospital، تفاصيل الـOwnership Model لم يتم تحديدها بشكل كافٍ حتى الآن، لذلك لن نفترضها.

2.5 Organization Membership

المستخدم يمكن أن يكون عضوًا في أكثر من مؤسسة.

مثال:

Veterinarian
│
├── Clinic A
│ └── Supervisor
│
├── Clinic B
│ └── Veterinarian
│
└── Farm A
└── Veterinarian

وبالتالي لا يجب أن يكون Membership مرتبطًا بحساب المستخدم بشكل عام فقط.

يجب أن يمثل العلاقة بين:

User

- Organization
- Membership Type
- Scope
- Permissions
  2.6 Core Relationships

العلاقات الأساسية الحالية:

Pet Owner
│
└── Owns ──→ Animal

Veterinarian
│
├── Works At ──→ Clinic
├── Works At ──→ Farm
└── Can Be ──→ Organization Supervisor

Clinic
│
├── Has ──→ Owner
├── Has ──→ Supervisors
└── Has ──→ Veterinarians

Farm
│
├── Has ──→ Owner
├── Has ──→ Supervisors
├── Has ──→ Veterinarians
└── Has ──→ Employees
2.7 Important Identity Rule

لا نريد أن ننشئ حسابًا منفصلًا للطبيب وحسابًا منفصلًا لصاحب الحيوان.

المبدأ هو:

One User Account
│
├── Pet Owner Context
│
└── Veterinarian Context

إذا كان المستخدم طبيبًا معتمدًا، يمكنه التبديل بين الـcontexts من داخل التطبيق.

2.8 Actor vs Role vs Membership

لازم نفرق في التحليل بين الثلاثة:

Actor

الشخص الذي يتفاعل مع النظام.

مثلاً:

User
Role

الصفة أو الدور الذي يمتلكه المستخدم.

مثلاً:

Pet Owner
Veterinarian
Admin
Moderator
Membership

علاقة المستخدم بمؤسسة معينة.

مثلاً:

User #123
↓
Clinic A
↓
Veterinarian

أو:

User #123
↓
Clinic A
↓
Supervisor

وهذا التفريق سيكون أساسًا مهمًا جدًا للـAuthorization لاحقًا.

النتيجة المبدئية للبند 02

لدينا حاليًا:

Core Roles
Admin
Moderator
Pet Owner
Veterinarian
Supervisor Contexts
System / Domain Supervisor
Organization Supervisor
Organizations
Clinic
Veterinary Office
Pet Owner Store
Veterinary Store
Poultry Farm
Syndicate
Hospital
Future Organizations / Operations
Cattle Farm
