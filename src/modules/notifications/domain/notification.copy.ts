import type { NotificationType } from './notification.constants.js';

/**
 * Stored / pushed notification text, per type, in the app's default language
 * (Arabic — `mobile/src/constants/config.ts` `DEFAULT_LANGUAGE`). The user's
 * language is not persisted server-side, so this is what the OS shows for a
 * push. The mobile client re-renders the in-app inbox from its own i18n
 * catalogue keyed by `type` (`notifications:types.<TYPE>`), falling back to
 * these strings — so the inbox follows the device language.
 *
 * Deliberately generic: no names, no message / consultation / medical content
 * — the user opens the app to see private details.
 */
export const NOTIFICATION_COPY: Record<NotificationType, { title: string; body: string }> = {
  // account
  ACCOUNT_STATUS_CHANGED: { title: 'تحديث حالة الحساب', body: 'تم تحديث حالة حسابك.' },
  // veterinarian approval
  VETERINARIAN_APPLICATION_SUBMITTED: {
    title: 'طلب تسجيل طبيب بيطري جديد',
    body: 'قدّم طبيب بيطري طلب تسجيل بانتظار المراجعة.',
  },
  VETERINARIAN_APPROVED: {
    title: 'تمت الموافقة على حسابك',
    body: 'تمت الموافقة على طلب تسجيلك كطبيب بيطري.',
  },
  VETERINARIAN_REJECTED: {
    title: 'لم تتم الموافقة على طلبك',
    body: 'تم رفض طلب تسجيلك كطبيب بيطري. اطّلع على التفاصيل في التطبيق.',
  },
  // organizations
  ORGANIZATION_SUBMITTED: {
    title: 'طلب تسجيل منشأة جديد',
    body: 'تم تسجيل منشأة جديدة بانتظار الموافقة.',
  },
  ORGANIZATION_APPROVED: { title: 'تمت الموافقة على منشأتك', body: 'تمت الموافقة على منشأتك.' },
  ORGANIZATION_REJECTED: {
    title: 'لم تتم الموافقة على منشأتك',
    body: 'تم رفض طلب تسجيل منشأتك.',
  },
  ORGANIZATION_SUSPENDED: { title: 'تم تعليق منشأتك', body: 'تم تعليق منشأتك.' },
  ORGANIZATION_ACTIVATED: { title: 'تمت إعادة تفعيل منشأتك', body: 'تمت إعادة تفعيل منشأتك.' },
  ORGANIZATION_DEACTIVATED: { title: 'تم إيقاف منشأتك', body: 'تم إيقاف منشأتك.' },
  ORGANIZATION_MEMBER_ADDED: { title: 'تمت إضافتك إلى منشأة', body: 'تمت إضافتك عضوًا في منشأة.' },
  ORGANIZATION_MEMBER_REMOVED: {
    title: 'تمت إزالتك من منشأة',
    body: 'تمت إزالتك من إحدى المنشآت.',
  },
  ORGANIZATION_ROLE_CHANGED: {
    title: 'تغيير دورك في المنشأة',
    body: 'تم تحديث دورك أو حالة عضويتك في إحدى المنشآت.',
  },
  ORGANIZATION_SUPERVISOR_ASSIGNED: {
    title: 'تعيين مشرف',
    body: 'تم تعيينك مشرفًا في إحدى المنشآت.',
  },
  SYSTEM_SUPERVISOR_ASSIGNED: { title: 'تعيين مشرف', body: 'تم تعيينك مشرفًا في النظام.' },
  // subscriptions
  SUBSCRIPTION_UPDATED: { title: 'تحديث الاشتراك', body: 'تم تحديث فترة اشتراك منشأتك.' },
  SUBSCRIPTION_EXPIRING: {
    title: 'اشتراكك يقترب من الانتهاء',
    body: 'سينتهي اشتراك منشأتك قريبًا. يمكنك طلب التجديد من التطبيق.',
  },
  SUBSCRIPTION_EXPIRED: {
    title: 'انتهى الاشتراك',
    body: 'انتهى اشتراك منشأتك. اطلب التجديد لمتابعة استخدام الخدمات.',
  },
  SUBSCRIPTION_RENEWAL_REQUESTED: {
    title: 'طلب تجديد اشتراك',
    body: 'أرسلت منشأة طلب تجديد اشتراك بانتظار المراجعة.',
  },
  SUBSCRIPTION_RENEWAL_APPROVED: {
    title: 'تمت الموافقة على التجديد',
    body: 'تمت الموافقة على طلب تجديد اشتراك منشأتك.',
  },
  SUBSCRIPTION_RENEWAL_REJECTED: {
    title: 'لم تتم الموافقة على التجديد',
    body: 'تم رفض طلب تجديد اشتراك منشأتك.',
  },
  // farms
  FARM_MEMBER_JOINED: { title: 'عضو جديد في الحقل', body: 'انضم عضو جديد إلى حقلك.' },
  FARM_APPOINTMENT_CREATED: { title: 'موعد جديد', body: 'تمت إضافة موعد جديد في الحقل.' },
  // traders
  TRADER_APPLICATION_SUBMITTED: {
    title: 'طلب تسجيل تاجر جديد',
    body: 'قدّم مستخدم طلب تسجيل تاجر بانتظار المراجعة.',
  },
  TRADER_APPROVED: {
    title: 'تمت الموافقة على حساب التاجر',
    body: 'يمكنك الآن استخدام سوق الدواجن كتاجر.',
  },
  TRADER_REJECTED: { title: 'لم تتم الموافقة على طلب التاجر', body: 'تم رفض طلب تسجيلك كتاجر.' },
  TRADER_SUSPENDED: { title: 'تم تعليق حساب التاجر', body: 'تم تعليق حسابك كتاجر.' },
  TRADER_REACTIVATED: {
    title: 'تمت إعادة تفعيل حساب التاجر',
    body: 'تمت إعادة تفعيل حسابك كتاجر.',
  },
  // chat
  CHAT_MESSAGE_RECEIVED: { title: 'رسالة جديدة', body: 'لديك رسالة جديدة.' },
  // consultations / inquiries / support
  CONSULTATION_CREATED: { title: 'استشارة جديدة', body: 'تم تقديم استشارة جديدة.' },
  CONSULTATION_MESSAGE_RECEIVED: {
    title: 'رد جديد على استشارة',
    body: 'هناك رسالة جديدة في استشارة.',
  },
  CONSULTATION_CLOSED: { title: 'تم إغلاق الاستشارة', body: 'تم إغلاق استشارتك.' },
  INQUIRY_CREATED: { title: 'استفسار جديد', body: 'تم تقديم استفسار جديد.' },
  INQUIRY_MESSAGE_RECEIVED: { title: 'رد جديد على استفسار', body: 'هناك رسالة جديدة في استفسار.' },
  INQUIRY_CLOSED: { title: 'تم إغلاق الاستفسار', body: 'تم إغلاق استفسارك.' },
  SUPPORT_CREATED: { title: 'رسالة دعم جديدة', body: 'تم إرسال رسالة دعم جديدة.' },
  SUPPORT_MESSAGE_RECEIVED: { title: 'رد جديد من الدعم', body: 'هناك رسالة جديدة في طلب الدعم.' },
  SUPPORT_CLOSED: { title: 'تم إغلاق طلب الدعم', body: 'تم إغلاق طلب الدعم الخاص بك.' },
  // veterinary services marketplace
  VET_SERVICE_LISTING_SUBMITTED: {
    title: 'خدمة جديدة للمراجعة',
    body: 'أرسل طبيب بيطري خدمة بانتظار الموافقة.',
  },
  VET_SERVICE_LISTING_APPROVED: { title: 'تمت الموافقة على خدمتك', body: 'أصبحت خدمتك منشورة.' },
  VET_SERVICE_LISTING_REJECTED: {
    title: 'لم تتم الموافقة على خدمتك',
    body: 'تحتاج خدمتك إلى تعديلات قبل نشرها.',
  },
  VET_SERVICE_REQUEST_SUBMITTED: {
    title: 'طلب خدمة جديد للمراجعة',
    body: 'أرسل مربٍّ طلب خدمة بانتظار الموافقة.',
  },
  VET_SERVICE_REQUEST_APPROVED: {
    title: 'تمت الموافقة على طلبك',
    body: 'أصبح طلب الخدمة منشورًا.',
  },
  VET_SERVICE_REQUEST_REJECTED: {
    title: 'لم تتم الموافقة على طلبك',
    body: 'يحتاج طلب الخدمة إلى تعديلات قبل نشره.',
  },
  VET_SERVICE_OFFER_RECEIVED: {
    title: 'عرض جديد على طلبك',
    body: 'قدّم طبيب بيطري عرضًا على طلبك.',
  },
  VET_SERVICE_OFFER_ACCEPTED: { title: 'تم قبول عرضك', body: 'تم قبول عرضك وفتح محادثة.' },
  VET_SERVICE_OFFER_REJECTED: { title: 'لم يتم قبول عرضك', body: 'اختار صاحب الطلب عرضًا آخر.' },
  VET_SERVICE_LISTING_REQUEST_RECEIVED: {
    title: 'طلب جديد على خدمتك',
    body: 'طلب أحد المستخدمين خدمتك.',
  },
  VET_SERVICE_LISTING_REQUEST_ACCEPTED: {
    title: 'تم قبول طلبك',
    body: 'قبل الطبيب طلبك وتم فتح محادثة.',
  },
  VET_SERVICE_LISTING_REQUEST_REJECTED: {
    title: 'تم رفض طلبك',
    body: 'اعتذر الطبيب عن طلب الخدمة.',
  },
  VET_SERVICE_DEAL_COMPLETED: { title: 'اكتملت الخدمة', body: 'تم إنهاء الخدمة.' },
  // courses & seminars
  VET_COURSE_SUBMITTED: {
    title: 'دورة/ندوة جديدة للمراجعة',
    body: 'أرسل طبيب بيطري دورة أو ندوة بانتظار الموافقة.',
  },
  VET_COURSE_APPROVED: {
    title: 'تمت الموافقة على الدورة/الندوة',
    body: 'أصبحت دورتك أو ندوتك منشورة.',
  },
  VET_COURSE_REJECTED: {
    title: 'لم تتم الموافقة على الدورة/الندوة',
    body: 'تحتاج دورتك أو ندوتك إلى تعديلات قبل نشرها.',
  },
  VET_COURSE_REGISTRATION_CONFIRMED: { title: 'تم تأكيد التسجيل', body: 'تم تأكيد تسجيلك.' },
  VET_COURSE_REGISTRATION_RECEIVED: {
    title: 'تسجيل جديد',
    body: 'سجّل مشارك جديد في دورتك أو ندوتك.',
  },
  VET_COURSE_CAPACITY_REACHED: {
    title: 'اكتمل العدد',
    body: 'اكتمل عدد المقاعد في دورتك أو ندوتك.',
  },
  VET_COURSE_CANCELLED: { title: 'تم الإلغاء', body: 'تم إلغاء دورة أو ندوة سجّلت فيها.' },
  // jobs
  VET_JOB_OFFER_SUBMITTED: {
    title: 'إعلان وظيفة للمراجعة',
    body: 'تم إرسال إعلان وظيفة بانتظار الموافقة.',
  },
  VET_JOB_OFFER_APPROVED: {
    title: 'تمت الموافقة على إعلان الوظيفة',
    body: 'أصبح إعلان الوظيفة منشورًا.',
  },
  VET_JOB_OFFER_REJECTED: {
    title: 'لم تتم الموافقة على إعلان الوظيفة',
    body: 'يحتاج إعلان الوظيفة إلى تعديلات قبل نشره.',
  },
  VET_JOB_SEEKER_PROFILE_SUBMITTED: {
    title: 'ملف باحث عن عمل للمراجعة',
    body: 'تم إرسال ملف باحث عن عمل بانتظار الموافقة.',
  },
  VET_JOB_SEEKER_PROFILE_APPROVED: {
    title: 'تمت الموافقة على ملفك',
    body: 'أصبح ملفك كباحث عن عمل منشورًا.',
  },
  VET_JOB_SEEKER_PROFILE_REJECTED: {
    title: 'لم تتم الموافقة على ملفك',
    body: 'يحتاج ملفك كباحث عن عمل إلى تعديلات.',
  },
  VET_JOB_APPLICATION_RECEIVED: { title: 'طلب توظيف جديد', body: 'تقدّم أحدهم لوظيفتك.' },
  VET_JOB_APPLICATION_ACCEPTED: { title: 'تم قبول طلبك', body: 'تم قبول طلب التوظيف وفتح محادثة.' },
  VET_JOB_APPLICATION_REJECTED: { title: 'لم يتم قبول طلبك', body: 'تم رفض طلب التوظيف.' },
  // store orders
  STORE_ORDER_PLACED: { title: 'طلب شراء جديد', body: 'تم استلام طلب شراء جديد.' },
  STORE_ORDER_STATUS_CHANGED: { title: 'تحديث حالة الطلب', body: 'تم تحديث حالة طلبك.' },
  // syndicates
  SYNDICATE_ANNOUNCEMENT_PUBLISHED: {
    title: 'إعلان جديد من النقابة',
    body: 'نشرت نقابة تتابعها إعلانًا جديدًا.',
  },
  SYNDICATE_SUBMISSION_CREATED: {
    title: 'طلب جديد للمراجعة',
    body: 'أرسل عضو طلبًا أو استفسارًا جديدًا.',
  },
  SYNDICATE_SUBMISSION_RESPONDED: {
    title: 'تم الرد على طلبك',
    body: 'ردّت النقابة على طلبك أو استفسارك.',
  },
  // content / admin
  CONTENT_PUBLISHED: { title: 'محتوى جديد', body: 'يتوفر محتوى جديد.' },
  ADMIN_ANNOUNCEMENT: { title: 'إعلان', body: 'لديك إعلان جديد.' },
  // animal publications
  PUBLICATION_SUBMITTED: {
    title: 'منشور جديد للمراجعة',
    body: 'تم إرسال منشور حيوان بانتظار الموافقة.',
  },
  PUBLICATION_APPROVED: { title: 'تمت الموافقة على منشورك', body: 'أصبح منشورك ظاهرًا للجميع.' },
  PUBLICATION_REJECTED: { title: 'لم تتم الموافقة على منشورك', body: 'تم رفض منشورك.' },
  PUBLICATION_ADOPTION_REQUESTED: {
    title: 'طلب تبنٍّ',
    body: 'هناك من يرغب في تبنّي حيوانك المعروض.',
  },
  PUBLICATION_MATING_REQUESTED: {
    title: 'طلب تزاوج',
    body: 'هناك من يرغب في التزاوج مع حيوانك المعروض.',
  },
  PUBLICATION_SIGHTING_REPORTED: {
    title: 'إبلاغ عن مشاهدة',
    body: 'أبلغ أحدهم عن مشاهدة حيوانك المفقود.',
  },
  // ownership transfer
  TRANSFER_REQUEST_RECEIVED: {
    title: 'طلب نقل ملكية',
    body: 'يرغب أحدهم في نقل ملكية حيوان إليك.',
  },
  TRANSFER_REQUEST_ACCEPTED: { title: 'تم قبول نقل الملكية', body: 'تم قبول طلب نقل الملكية.' },
  TRANSFER_REQUEST_REJECTED: { title: 'تم رفض نقل الملكية', body: 'تم رفض طلب نقل الملكية.' },
  // clinic appointments
  CLINIC_APPOINTMENT_REQUESTED: { title: 'طلب موعد جديد', body: 'طلب أحد المربين موعدًا.' },
  CLINIC_APPOINTMENT_CONFIRMED: { title: 'تم تأكيد الموعد', body: 'تم تأكيد موعدك.' },
  CLINIC_APPOINTMENT_REJECTED: { title: 'تم رفض الموعد', body: 'اعتذرت العيادة عن طلب الموعد.' },
  CLINIC_APPOINTMENT_RESCHEDULE_PROPOSED: {
    title: 'موعد بديل مقترح',
    body: 'اقترحت العيادة موعدًا مختلفًا.',
  },
  CLINIC_APPOINTMENT_CANCELLED: { title: 'تم إلغاء الموعد', body: 'تم إلغاء موعد.' },
  CLINIC_APPOINTMENT_COMPLETED: { title: 'اكتمل الموعد', body: 'تم تسجيل موعدك كمكتمل.' },
  // Real title/body are sender-supplied (organizationBroadcastToFollowers);
  // this entry only satisfies the exhaustiveness check.
  ORGANIZATION_BROADCAST: {
    title: 'رسالة من منشأة تتابعها',
    body: 'أرسلت منشأة تتابعها رسالة.',
  },
};
