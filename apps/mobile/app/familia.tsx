import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import * as Contacts from 'expo-contacts';
import { familyAPI, tasksAPI } from '@/lib/api';
import { useVoiceStore } from '@/store/voice';
import { useSettingsStore } from '@/store/settings';
import { T } from '@/lib/theme';
import { WaveBackground } from '@/components/WaveBackground';
import {
  ArrowLeft,
  Plus,
  MessageCircle,
  CheckSquare,
  Send,
  X,
  Users,
  UserPlus,
  Mail,
  Phone,
} from 'lucide-react-native';

// ─── Types ───────────────────────────────────────────────────────────────────

type FamilyMember = {
  id: string;
  name: string;
  role: string;
  age?: number;
  whatsapp?: string;
  email?: string;
  notes?: string;
};

type FamilyTask = {
  id: string;
  title: string;
  status: string;
  metadata?: { child_name?: string; assigned_to?: string } | null;
};

// ─── Strings (4 idiomas) ─────────────────────────────────────────────────────

const S = {
  es: {
    title: 'Mi Familia',
    subtitle: 'Coordina con Leeloo',
    members: 'Miembros',
    noMembers: 'Aún no tienes miembros en tu familia.\nDile a Leeloo: "Agrega a Sofia, 8 años"',
    addMember: 'Agregar miembro',
    fromContacts: 'Desde contactos',
    today: 'Tareas de hoy',
    noTasks: 'Sin tareas asignadas hoy.',
    msgPlaceholder: 'Escribe el mensaje...',
    send: 'Enviar',
    cancel: 'Cancelar',
    msgSent: '¡Mensaje enviado por Leeloo!',
    msgError: 'No se pudo enviar el mensaje.',
    addForm: {
      title: 'Nuevo miembro',
      name: 'Nombre',
      role: 'Rol',
      age: 'Edad (opcional)',
      whatsapp: 'WhatsApp (opcional)',
      email: 'Correo (opcional)',
      save: 'Guardar',
      namePlaceholder: 'Ej: Sofia',
      agePlaceholder: 'Ej: 8',
      wpPlaceholder: '+57 300 000 0000',
      emailPlaceholder: 'sofia@gmail.com',
    },
    contactsPick: 'Selecciona un contacto',
    contactsPermDenied: 'Permiso de contactos denegado.',
    years: 'años',
    tip: 'Leeloo aprende sobre tu familia cuando lo mencionas en conversación.',
    msgTo: 'Mensaje para',
    message: 'Mensaje',
    roles: ['hijo', 'hija', 'esposo', 'esposa', 'madre', 'padre', 'hermano', 'hermana', 'otro'],
  },
  en: {
    title: 'My Family',
    subtitle: 'Coordinate with Leeloo',
    members: 'Members',
    noMembers: 'You haven\'t added family members yet.\nTell Leeloo: "Add Sofia, 8 years old"',
    addMember: 'Add member',
    fromContacts: 'From contacts',
    today: "Today's tasks",
    noTasks: 'No tasks assigned today.',
    msgPlaceholder: 'Type your message...',
    send: 'Send',
    cancel: 'Cancel',
    msgSent: 'Message sent via Leeloo!',
    msgError: 'Could not send the message.',
    addForm: {
      title: 'New member',
      name: 'Name',
      role: 'Role',
      age: 'Age (optional)',
      whatsapp: 'WhatsApp (optional)',
      email: 'Email (optional)',
      save: 'Save',
      namePlaceholder: 'E.g. Sofia',
      agePlaceholder: 'E.g. 8',
      wpPlaceholder: '+1 555 000 0000',
      emailPlaceholder: 'sofia@gmail.com',
    },
    contactsPick: 'Select a contact',
    contactsPermDenied: 'Contacts permission denied.',
    years: 'years',
    tip: 'Leeloo learns about your family when you mention them in conversation.',
    msgTo: 'Message for',
    message: 'Message',
    roles: ['son', 'daughter', 'husband', 'wife', 'mother', 'father', 'brother', 'sister', 'other'],
  },
  pt: {
    title: 'Minha Família',
    subtitle: 'Coordene com Leeloo',
    members: 'Membros',
    noMembers: 'Você ainda não adicionou membros.\nDiga à Leeloo: "Adiciona Sofia, 8 anos"',
    addMember: 'Adicionar membro',
    fromContacts: 'Dos contatos',
    today: 'Tarefas de hoje',
    noTasks: 'Sem tarefas atribuídas hoje.',
    msgPlaceholder: 'Escreva sua mensagem...',
    send: 'Enviar',
    cancel: 'Cancelar',
    msgSent: 'Mensagem enviada pela Leeloo!',
    msgError: 'Não foi possível enviar a mensagem.',
    addForm: {
      title: 'Novo membro',
      name: 'Nome',
      role: 'Papel',
      age: 'Idade (opcional)',
      whatsapp: 'WhatsApp (opcional)',
      email: 'E-mail (opcional)',
      save: 'Salvar',
      namePlaceholder: 'Ex: Sofia',
      agePlaceholder: 'Ex: 8',
      wpPlaceholder: '+55 11 00000-0000',
      emailPlaceholder: 'sofia@gmail.com',
    },
    contactsPick: 'Selecione um contato',
    contactsPermDenied: 'Permissão de contatos negada.',
    years: 'anos',
    tip: 'Leeloo aprende sobre sua família quando você a menciona na conversa.',
    msgTo: 'Mensagem para',
    message: 'Mensagem',
    roles: ['filho', 'filha', 'esposo', 'esposa', 'mãe', 'pai', 'irmão', 'irmã', 'outro'],
  },
  fr: {
    title: 'Ma Famille',
    subtitle: 'Coordonnez avec Leeloo',
    members: 'Membres',
    noMembers: 'Vous n\'avez pas encore de membres.\nDites à Leeloo : "Ajoute Sofia, 8 ans"',
    addMember: 'Ajouter un membre',
    fromContacts: 'Depuis contacts',
    today: "Tâches d'aujourd'hui",
    noTasks: "Aucune tâche assignée aujourd'hui.",
    msgPlaceholder: 'Écrivez votre message...',
    send: 'Envoyer',
    cancel: 'Annuler',
    msgSent: 'Message envoyé par Leeloo !',
    msgError: "Impossible d'envoyer le message.",
    addForm: {
      title: 'Nouveau membre',
      name: 'Nom',
      role: 'Rôle',
      age: 'Âge (optionnel)',
      whatsapp: 'WhatsApp (optionnel)',
      email: 'E-mail (optionnel)',
      save: 'Enregistrer',
      namePlaceholder: 'Ex : Sofia',
      agePlaceholder: 'Ex : 8',
      wpPlaceholder: '+33 6 00 00 00 00',
      emailPlaceholder: 'sofia@gmail.com',
    },
    contactsPick: 'Sélectionnez un contact',
    contactsPermDenied: 'Permission contacts refusée.',
    years: 'ans',
    tip: 'Leeloo apprend à connaître votre famille quand vous en parlez.',
    msgTo: 'Message pour',
    message: 'Message',
    roles: ['fils', 'fille', 'mari', 'femme', 'mère', 'père', 'frère', 'sœur', 'autre'],
  },
} as const;

type Lang = keyof typeof S;

const getLang = (l: string): Lang => (l === 'en' || l === 'pt' || l === 'fr' ? l : 'es');

// ─── Role emoji helper ────────────────────────────────────────────────────────

const ROLE_EMOJIS: Record<string, string> = {
  hijo: '👦',
  hija: '👧',
  esposo: '👨',
  esposa: '👩',
  madre: '👩',
  padre: '👨',
  hermano: '👦',
  hermana: '👧',
  son: '👦',
  daughter: '👧',
  husband: '👨',
  wife: '👩',
  mother: '👩',
  father: '👨',
  brother: '👦',
  sister: '👧',
  filho: '👦',
  filha: '👧',
  mãe: '👩',
  pai: '👨',
  irmão: '👦',
  irmã: '👧',
  fils: '👦',
  fille: '👧',
  mari: '👨',
  femme: '👩',
  frère: '👦',
  sœur: '👧',
};
const roleEmoji = (role: string) => ROLE_EMOJIS[role.toLowerCase()] ?? '👤';

const AVATAR_COLORS = [
  ['#F07040', '#C4507A'],
  ['#8375FA', '#C4507A'],
  ['#3B82F6', '#8375FA'],
  ['#10B981', '#3B82F6'],
  ['#F59E0B', '#F07040'],
];

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function FamiliaScreen() {
  const router = useRouter();
  const language = useSettingsStore((s) => s.language);
  const sendText = useVoiceStore((s) => s.sendText);
  const lang = getLang(language);
  const t = S[lang];

  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [tasks, setTasks] = useState<FamilyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMember, setSelectedMember] = useState<FamilyMember | null>(null);
  const [msgText, setMsgText] = useState('');
  const [sending, setSending] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [prefill, setPrefill] = useState<Partial<FamilyMember> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [famRes, taskRes] = await Promise.allSettled([
        familyAPI.list(),
        tasksAPI.getTasks({ status: 'pending', limit: 30 }),
      ]);
      if (famRes.status === 'fulfilled') {
        const d = famRes.value.data as any;
        setMembers(Array.isArray(d?.members) ? d.members : []);
      }
      if (taskRes.status === 'fulfilled') {
        const d = taskRes.value.data as any;
        const all: FamilyTask[] = Array.isArray(d?.tasks) ? d.tasks : Array.isArray(d) ? d : [];
        setTasks(all.filter((tk) => tk.metadata?.child_name || tk.metadata?.assigned_to));
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // ── Pick from device contacts ──
  const handlePickContact = async () => {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('', t.contactsPermDenied);
      return;
    }
    const { data } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
      sort: Contacts.SortTypes.FirstName,
    });
    if (!data.length) return;

    // Show picker alert — simple list of first 20 contacts with phone/email
    const candidates = data.filter((c) => c.name).slice(0, 20);

    Alert.alert(t.contactsPick, '', [
      ...candidates.map((c) => ({
        text: c.name!,
        onPress: () => {
          const phone = c.phoneNumbers?.[0]?.number ?? '';
          const email = c.emails?.[0]?.email ?? '';
          setPrefill({ name: c.name!, whatsapp: phone, email });
          setShowAdd(true);
        },
      })),
      { text: t.cancel, style: 'cancel' },
    ]);
  };

  const handleSendMessage = async () => {
    if (!selectedMember || !msgText.trim()) return;
    setSending(true);
    try {
      await sendText(
        lang === 'en'
          ? `Send a message to ${selectedMember.name}: "${msgText.trim()}"`
          : lang === 'pt'
            ? `Envie uma mensagem para ${selectedMember.name}: "${msgText.trim()}"`
            : lang === 'fr'
              ? `Envoie un message à ${selectedMember.name} : "${msgText.trim()}"`
              : `Envíale un mensaje a ${selectedMember.name}: "${msgText.trim()}"`,
      );
      Alert.alert('', t.msgSent);
      setMsgText('');
      setSelectedMember(null);
    } catch {
      Alert.alert('', t.msgError);
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: T.colors.cream }}>
      <WaveBackground opacity={0.05} cellSize={38} />
      <SafeAreaView style={{ flex: 1 }}>
        {/* ── Header ── */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <ArrowLeft size={22} color={T.colors.navy} strokeWidth={2} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>{t.title}</Text>
            <Text style={s.headerSub}>{t.subtitle}</Text>
          </View>
          <TouchableOpacity
            onPress={handlePickContact}
            style={[s.addBtn, { backgroundColor: '#3B82F6', marginRight: 8 }]}
          >
            <UserPlus size={18} color="#FFF" strokeWidth={2} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setPrefill(null);
              setShowAdd(true);
            }}
            style={s.addBtn}
          >
            <Plus size={20} color={T.colors.white} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          {loading ? (
            <ActivityIndicator color={T.colors.purple} style={{ marginTop: 40 }} />
          ) : (
            <>
              {/* ── Members grid ── */}
              <Text style={s.sectionTitle}>{t.members}</Text>
              {members.length === 0 ? (
                <View style={s.emptyCard}>
                  <Users size={32} color={T.colors.muted} strokeWidth={1.5} />
                  <Text style={s.emptyText}>{t.noMembers}</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      style={[s.emptyBtn, { backgroundColor: '#3B82F6' }]}
                      onPress={handlePickContact}
                    >
                      <Text style={s.emptyBtnText}>{t.fromContacts}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.emptyBtn}
                      onPress={() => {
                        setPrefill(null);
                        setShowAdd(true);
                      }}
                    >
                      <Text style={s.emptyBtnText}>{t.addMember}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={s.membersGrid}>
                  {members.map((m, idx) => (
                    <MemberCard
                      key={m.id}
                      member={m}
                      colors={AVATAR_COLORS[idx % AVATAR_COLORS.length]}
                      tasks={tasks.filter((tk) =>
                        (tk.metadata?.child_name ?? tk.metadata?.assigned_to ?? '')
                          .toLowerCase()
                          .includes(m.name.toLowerCase()),
                      )}
                      onMessage={() => setSelectedMember(m)}
                      t={t}
                    />
                  ))}
                  <TouchableOpacity style={s.addCard} onPress={handlePickContact}>
                    <UserPlus size={26} color="#3B82F6" strokeWidth={2} />
                    <Text style={[s.addCardLabel, { color: '#3B82F6' }]}>{t.fromContacts}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.addCard}
                    onPress={() => {
                      setPrefill(null);
                      setShowAdd(true);
                    }}
                  >
                    <Plus size={28} color={T.colors.purple} strokeWidth={2} />
                    <Text style={s.addCardLabel}>{t.addMember}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* ── Family tasks ── */}
              {tasks.length > 0 && (
                <>
                  <Text style={s.sectionTitle}>{t.today}</Text>
                  <View style={s.taskList}>
                    {tasks.map((tk) => (
                      <FamilyTaskRow key={tk.id} task={tk} />
                    ))}
                  </View>
                </>
              )}

              {/* ── Tip ── */}
              <View style={s.tipCard}>
                <Text style={s.tipIcon}>💡</Text>
                <Text style={s.tipText}>{t.tip}</Text>
              </View>
            </>
          )}
        </ScrollView>

        {/* ── Message modal ── */}
        <Modal
          visible={!!selectedMember}
          animationType="slide"
          transparent
          presentationStyle="overFullScreen"
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={s.modalOverlay}
          >
            <View style={s.modalSheet}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>
                  {t.msgTo} {selectedMember?.name}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setSelectedMember(null);
                    setMsgText('');
                  }}
                >
                  <X size={22} color={T.colors.muted} />
                </TouchableOpacity>
              </View>
              {selectedMember?.whatsapp && (
                <Text style={s.modalSub}>
                  <Phone size={12} color={T.colors.muted} /> {selectedMember.whatsapp}
                </Text>
              )}
              {selectedMember?.email && (
                <Text style={s.modalSub}>
                  <Mail size={12} color={T.colors.muted} /> {selectedMember.email}
                </Text>
              )}
              <TextInput
                style={[s.msgInput, { marginTop: 12 }]}
                value={msgText}
                onChangeText={setMsgText}
                placeholder={t.msgPlaceholder}
                placeholderTextColor="#AAA"
                multiline
                autoFocus
                maxLength={500}
              />
              <View style={s.modalActions}>
                <TouchableOpacity
                  style={s.cancelBtn}
                  onPress={() => {
                    setSelectedMember(null);
                    setMsgText('');
                  }}
                >
                  <Text style={s.cancelBtnText}>{t.cancel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.sendBtn, (!msgText.trim() || sending) && { opacity: 0.5 }]}
                  onPress={handleSendMessage}
                  disabled={!msgText.trim() || sending}
                >
                  <LinearGradient
                    colors={['#F07040', '#C4507A', '#8375FA']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={s.sendBtnGrad}
                  >
                    {sending ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <>
                        <Send size={16} color="#FFF" strokeWidth={2} />
                        <Text style={s.sendBtnText}>{t.send}</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* ── Add member modal ── */}
        <AddMemberModal
          visible={showAdd}
          lang={lang}
          prefill={prefill}
          onClose={() => {
            setShowAdd(false);
            setPrefill(null);
          }}
          onSaved={load}
        />
      </SafeAreaView>
    </View>
  );
}

// ─── Member Card ─────────────────────────────────────────────────────────────

function MemberCard({
  member,
  colors,
  tasks,
  onMessage,
  t,
}: {
  member: FamilyMember;
  colors: string[];
  tasks: FamilyTask[];
  onMessage: () => void;
  t: (typeof S)[Lang];
}) {
  return (
    <View style={s.memberCard}>
      <LinearGradient colors={colors as [string, string]} style={s.avatar}>
        <Text style={s.avatarText}>{member.name.charAt(0).toUpperCase()}</Text>
      </LinearGradient>
      <Text style={s.memberName}>{member.name}</Text>
      <Text style={s.memberRole}>
        {roleEmoji(member.role)} {member.role}
        {member.age ? ` · ${member.age} ${t.years}` : ''}
      </Text>

      {/* Contact info pills */}
      {member.whatsapp ? (
        <View style={s.contactPill}>
          <Phone size={11} color="#25D366" strokeWidth={2} />
          <Text style={s.contactPillText} numberOfLines={1}>
            {member.whatsapp}
          </Text>
        </View>
      ) : null}
      {member.email ? (
        <View style={s.contactPill}>
          <Mail size={11} color={T.colors.purple} strokeWidth={2} />
          <Text style={s.contactPillText} numberOfLines={1}>
            {member.email}
          </Text>
        </View>
      ) : null}

      {tasks.length > 0 && (
        <View style={s.taskBadge}>
          <CheckSquare size={12} color={T.colors.purple} strokeWidth={2} />
          <Text style={s.taskBadgeText}>{tasks.length}</Text>
        </View>
      )}
      <TouchableOpacity style={s.msgBtn} onPress={onMessage} activeOpacity={0.8}>
        <MessageCircle size={16} color={T.colors.purple} strokeWidth={2} />
        <Text style={s.msgBtnText}>{t.message}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Family Task Row ──────────────────────────────────────────────────────────

function FamilyTaskRow({ task }: { task: FamilyTask }) {
  const assignee = task.metadata?.child_name ?? task.metadata?.assigned_to ?? '';
  return (
    <View style={s.taskRow}>
      <View style={s.taskDot} />
      <View style={{ flex: 1 }}>
        <Text style={s.taskTitle} numberOfLines={1}>
          {task.title}
        </Text>
        {!!assignee && <Text style={s.taskAssignee}>→ {assignee}</Text>}
      </View>
    </View>
  );
}

// ─── Add Member Modal ─────────────────────────────────────────────────────────

function AddMemberModal({
  visible,
  lang,
  prefill,
  onClose,
  onSaved,
}: {
  visible: boolean;
  lang: Lang;
  prefill: Partial<FamilyMember> | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = S[lang];

  const [name, setName] = useState(prefill?.name ?? '');
  const [role, setRole] = useState<string>(t.roles[0]);
  const [age, setAge] = useState(prefill?.age ? String(prefill.age) : '');
  const [whatsapp, setWhatsapp] = useState(prefill?.whatsapp ?? '');
  const [email, setEmail] = useState(prefill?.email ?? '');
  const [saving, setSaving] = useState(false);

  // Sync prefill when it changes (contact picker)
  const resetWithPrefill = useCallback(
    (p: Partial<FamilyMember> | null) => {
      setName(p?.name ?? '');
      setRole(t.roles[0]);
      setAge(p?.age ? String(p.age) : '');
      setWhatsapp(p?.whatsapp ?? '');
      setEmail(p?.email ?? '');
    },
    [t.roles],
  );

  useFocusEffect(
    useCallback(() => {
      if (visible) resetWithPrefill(prefill);
    }, [visible, prefill, resetWithPrefill]),
  );

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await familyAPI.add({
        name: name.trim(),
        role,
        age: age ? Number(age) : undefined,
        whatsapp: whatsapp.trim() || undefined,
        email: email.trim() || undefined,
      });
      resetWithPrefill(null);
      onClose();
      onSaved();
    } catch {
      Alert.alert(
        'Error',
        lang === 'en' ? 'Could not save member.' : 'No se pudo guardar el miembro.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.modalOverlay}
      >
        <ScrollView contentContainerStyle={s.modalSheet} keyboardShouldPersistTaps="handled">
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>{t.addForm.title}</Text>
            <TouchableOpacity
              onPress={() => {
                resetWithPrefill(null);
                onClose();
              }}
            >
              <X size={22} color={T.colors.muted} />
            </TouchableOpacity>
          </View>

          <Text style={s.fieldLabel}>{t.addForm.name}</Text>
          <TextInput
            style={s.fieldInput}
            value={name}
            onChangeText={setName}
            placeholder={t.addForm.namePlaceholder}
            placeholderTextColor="#AAA"
            autoFocus
            maxLength={40}
          />

          <Text style={s.fieldLabel}>{t.addForm.role}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginBottom: 14 }}
          >
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {t.roles.map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[s.roleChip, role === r && s.roleChipActive]}
                  onPress={() => setRole(r)}
                >
                  <Text style={[s.roleChipText, role === r && s.roleChipTextActive]}>
                    {roleEmoji(r)} {r}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <Text style={s.fieldLabel}>{t.addForm.age}</Text>
          <TextInput
            style={s.fieldInput}
            value={age}
            onChangeText={setAge}
            placeholder={t.addForm.agePlaceholder}
            placeholderTextColor="#AAA"
            keyboardType="number-pad"
            maxLength={3}
          />

          <Text style={s.fieldLabel}>{t.addForm.whatsapp}</Text>
          <TextInput
            style={s.fieldInput}
            value={whatsapp}
            onChangeText={setWhatsapp}
            placeholder={t.addForm.wpPlaceholder}
            placeholderTextColor="#AAA"
            keyboardType="phone-pad"
            maxLength={25}
          />

          <Text style={s.fieldLabel}>{t.addForm.email}</Text>
          <TextInput
            style={s.fieldInput}
            value={email}
            onChangeText={setEmail}
            placeholder={t.addForm.emailPlaceholder}
            placeholderTextColor="#AAA"
            keyboardType="email-address"
            autoCapitalize="none"
            maxLength={80}
          />

          <View style={[s.modalActions, { marginTop: 4 }]}>
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={() => {
                resetWithPrefill(null);
                onClose();
              }}
            >
              <Text style={s.cancelBtnText}>{t.cancel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.sendBtn, (!name.trim() || saving) && { opacity: 0.5 }]}
              onPress={handleSave}
              disabled={!name.trim() || saving}
            >
              <LinearGradient
                colors={['#F07040', '#C4507A', '#8375FA']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={s.sendBtnGrad}
              >
                {saving ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={s.sendBtnText}>{t.addForm.save}</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: T.colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', fontFamily: T.fonts.bold, color: T.colors.navy },
  headerSub: { fontSize: 13, color: T.colors.muted, fontFamily: T.fonts.regular },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: T.colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: T.colors.purple,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
    color: T.colors.navy,
    marginTop: 20,
    marginBottom: 12,
  },
  // Members
  membersGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  memberCard: {
    width: '46%',
    backgroundColor: T.colors.white,
    borderRadius: T.radius.lg,
    padding: 14,
    alignItems: 'center',
    gap: 5,
    shadowColor: T.colors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 3,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  avatarText: { fontSize: 24, color: '#FFF', fontWeight: '800', fontFamily: T.fonts.bold },
  memberName: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
    color: T.colors.navy,
    textAlign: 'center',
  },
  memberRole: {
    fontSize: 12,
    color: T.colors.muted,
    fontFamily: T.fonts.regular,
    textAlign: 'center',
  },
  contactPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    maxWidth: '100%',
  },
  contactPillText: {
    fontSize: 10,
    color: T.colors.muted,
    fontFamily: T.fonts.regular,
    flexShrink: 1,
  },
  taskBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0EDFF',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  taskBadgeText: { fontSize: 12, color: T.colors.purple, fontFamily: T.fonts.semiBold },
  msgBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: T.colors.purple,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 2,
  },
  msgBtnText: { fontSize: 13, color: T.colors.purple, fontFamily: T.fonts.semiBold },
  addCard: {
    width: '46%',
    backgroundColor: '#F8F7FF',
    borderRadius: T.radius.lg,
    borderWidth: 2,
    borderColor: '#E8E4FF',
    borderStyle: 'dashed',
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 140,
  },
  addCardLabel: {
    fontSize: 12,
    color: T.colors.purple,
    fontFamily: T.fonts.semiBold,
    textAlign: 'center',
  },
  // Empty
  emptyCard: {
    backgroundColor: T.colors.white,
    borderRadius: T.radius.lg,
    padding: 28,
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  emptyText: {
    fontSize: 14,
    color: T.colors.muted,
    fontFamily: T.fonts.regular,
    textAlign: 'center',
    lineHeight: 22,
  },
  emptyBtn: {
    backgroundColor: T.colors.purple,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  emptyBtnText: { color: '#FFF', fontSize: 13, fontFamily: T.fonts.semiBold },
  // Tasks
  taskList: { gap: 8 },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: T.colors.white,
    borderRadius: T.radius.md,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  taskDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: T.colors.purple },
  taskTitle: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: T.fonts.semiBold,
    color: T.colors.navy,
  },
  taskAssignee: { fontSize: 12, color: T.colors.muted, fontFamily: T.fonts.regular },
  // Tip
  tipCard: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: 'rgba(131,117,250,0.07)',
    borderRadius: T.radius.md,
    borderWidth: 1,
    borderColor: 'rgba(131,117,250,0.15)',
    padding: 14,
    marginTop: 20,
  },
  tipIcon: { fontSize: 18 },
  tipText: { flex: 1, fontSize: 13, color: '#4B4890', fontFamily: T.fonts.regular, lineHeight: 19 },
  // Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: {
    backgroundColor: T.colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', fontFamily: T.fonts.bold, color: T.colors.navy },
  modalSub: { fontSize: 12, color: T.colors.muted, fontFamily: T.fonts.regular, marginBottom: 2 },
  msgInput: {
    backgroundColor: '#F9F9F9',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: T.colors.purple,
    padding: 14,
    fontSize: 15,
    fontFamily: T.fonts.regular,
    color: T.colors.navy,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  modalActions: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: T.colors.border,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: 15, color: T.colors.muted, fontFamily: T.fonts.semiBold },
  sendBtn: { flex: 1.6, borderRadius: 12, overflow: 'hidden' },
  sendBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  sendBtnText: { color: '#FFF', fontSize: 15, fontFamily: T.fonts.bold },
  // Form fields
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: T.fonts.semiBold,
    color: T.colors.navy,
    marginBottom: 6,
  },
  fieldInput: {
    backgroundColor: '#F9F9F9',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: T.colors.border,
    padding: 12,
    fontSize: 15,
    fontFamily: T.fonts.regular,
    color: T.colors.navy,
    marginBottom: 14,
  },
  roleChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: T.colors.border,
    backgroundColor: T.colors.white,
  },
  roleChipActive: { borderColor: T.colors.purple, backgroundColor: '#F0EDFF' },
  roleChipText: { fontSize: 13, color: T.colors.muted, fontFamily: T.fonts.semiBold },
  roleChipTextActive: { color: T.colors.purple },
});
