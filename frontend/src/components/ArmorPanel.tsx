import { ArmorSlot, ArmorSlotId } from '../types';

interface ArmorPanelProps {
  armorItems: ArmorSlot[];
  onUnequip: (slot: ArmorSlotId) => void;
  disabled?: boolean;
}

const SLOT_META: Record<ArmorSlotId, { label: string; icon: string; emptyLabel: string }> = {
  head:  { label: 'Head',  icon: '🪖', emptyLabel: 'No Helmet'     },
  torso: { label: 'Torso', icon: '🦺', emptyLabel: 'No Chestplate' },
  legs:  { label: 'Legs',  icon: '👖', emptyLabel: 'No Leggings'   },
  feet:  { label: 'Feet',  icon: '👟', emptyLabel: 'No Boots'      },
};

const SLOT_ORDER: ArmorSlotId[] = ['head', 'torso', 'legs', 'feet'];

export default function ArmorPanel({ armorItems, onUnequip, disabled = false }: ArmorPanelProps) {
  const slotMap = new Map<ArmorSlotId, ArmorSlot>(armorItems.map((s) => [s.slot, s]));

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerIcon}>🛡</span>
        <span style={styles.headerTitle}>Equipped Armor</span>
      </div>
      <ul style={styles.list}>
        {SLOT_ORDER.map((slotId) => {
          const meta = SLOT_META[slotId];
          const slot = slotMap.get(slotId);
          const hasItem = !!slot?.name;

          return (
            <li key={slotId} style={styles.row}>
              <span style={styles.slotIcon}>{meta.icon}</span>
              <span style={styles.slotLabel}>{meta.label}</span>
              <span style={{ ...styles.itemName, color: hasItem ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                {hasItem ? (slot.displayName ?? slot.name) : meta.emptyLabel}
              </span>
              {hasItem && (
                <button
                  style={{ ...styles.dropBtn, opacity: disabled ? 0.5 : 1 }}
                  onClick={() => onUnequip(slotId)}
                  disabled={disabled}
                  title={`Un-equip and drop ${slot.displayName ?? slot.name}`}
                >
                  Drop
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: 'var(--color-surface)',
    border: '2px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    padding: '1rem 1.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.65rem',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
  },
  headerIcon: {
    fontSize: '1rem',
  },
  headerTitle: {
    fontSize: '0.85rem',
    fontWeight: 700,
    color: 'var(--color-text)',
    letterSpacing: '0.04em',
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.4rem 0.6rem',
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
  },
  slotIcon: {
    fontSize: '1rem',
    flexShrink: 0,
  },
  slotLabel: {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: 'var(--color-text-muted)',
    width: '36px',
    flexShrink: 0,
  },
  itemName: {
    flex: 1,
    fontSize: '0.82rem',
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  dropBtn: {
    background: 'transparent',
    border: '1.5px solid var(--color-error)',
    color: 'var(--color-error)',
    borderRadius: 'var(--radius-sm)',
    padding: '0.2rem 0.55rem',
    fontSize: '0.72rem',
    fontWeight: 700,
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background 0.15s, color 0.15s',
    lineHeight: 1.4,
  },
};
