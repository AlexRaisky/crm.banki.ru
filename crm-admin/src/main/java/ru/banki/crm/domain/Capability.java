package ru.banki.crm.domain;

/**
 * Что учётка может делать в разделе. Read = раздел виден (замена прежней записи в
 * user_sections), остальные — операции над записями раздела. Проверяются на сервере
 * по глаголу HTTP: POST → ADD, PUT/PATCH → EDIT, DELETE → DELETE, GET → READ.
 */
public enum Capability {
    READ, ADD, EDIT, DELETE
}
