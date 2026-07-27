package ru.banki.crm.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

import java.util.Objects;

/**
 * Права одной учётки на один раздел — строка app.user_sections. Хранится как
 * элемент @ElementCollection у {@link AppUser}: чтобы правки флагов сохранялись,
 * коллекцию у пользователя всегда ЗАМЕНЯЮТ целиком (новый Set), а не мутируют
 * элементы на месте — equals/hashCode считаются по всем полям, и мутация на месте
 * сломала бы Set. См. UserService, где набор пересобирается на каждое сохранение.
 */
@Embeddable
public class SectionAccess {

    @Column(name = "section_id", nullable = false)
    private String sectionId;

    @Column(name = "can_read", nullable = false)
    private boolean canRead = true;

    @Column(name = "can_add", nullable = false)
    private boolean canAdd;

    @Column(name = "can_edit", nullable = false)
    private boolean canEdit;

    @Column(name = "can_delete", nullable = false)
    private boolean canDelete;

    public SectionAccess() {}

    public SectionAccess(String sectionId, boolean canRead, boolean canAdd,
                         boolean canEdit, boolean canDelete) {
        this.sectionId = sectionId;
        this.canRead = canRead;
        this.canAdd = canAdd;
        this.canEdit = canEdit;
        this.canDelete = canDelete;
    }

    public boolean has(Capability cap) {
        return switch (cap) {
            case READ -> canRead;
            case ADD -> canAdd;
            case EDIT -> canEdit;
            case DELETE -> canDelete;
        };
    }

    public String getSectionId() { return sectionId; }
    public void setSectionId(String sectionId) { this.sectionId = sectionId; }
    public boolean isCanRead() { return canRead; }
    public void setCanRead(boolean canRead) { this.canRead = canRead; }
    public boolean isCanAdd() { return canAdd; }
    public void setCanAdd(boolean canAdd) { this.canAdd = canAdd; }
    public boolean isCanEdit() { return canEdit; }
    public void setCanEdit(boolean canEdit) { this.canEdit = canEdit; }
    public boolean isCanDelete() { return canDelete; }
    public void setCanDelete(boolean canDelete) { this.canDelete = canDelete; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof SectionAccess that)) return false;
        return canRead == that.canRead && canAdd == that.canAdd
                && canEdit == that.canEdit && canDelete == that.canDelete
                && Objects.equals(sectionId, that.sectionId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(sectionId, canRead, canAdd, canEdit, canDelete);
    }
}
