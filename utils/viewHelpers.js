const formatDate = (value) => {
    if (!value) return '-';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return '-';
    }

    return date.toLocaleDateString('fr-FR');
};

const formatDateTime = (value) => {
    if (!value) return '-';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return '-';
    }

    return date.toLocaleString('fr-FR');
};

const truncate = (value, max = 90) => {
    const text = String(value || '').trim();

    if (!text) return '-';
    if (text.length <= max) return text;

    return `${text.slice(0, max)}...`;
};

const formatEnumLabel = (value) => {
    if (!value) return '-';

    return String(value)
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, (char) => char.toUpperCase());
};

const badgeClassFor = (value) => {
    const key = String(value || '').toUpperCase();

    switch (key) {
        case 'TRAITEE':
        case 'PUBLISHED':
        case 'PUBLIÉE':
        case 'NORMAL':
        case 'OUI':
            return 'badge-success';

        case 'EN_TRAITEMENT':
        case 'IMPORTANTE':
        case 'MODIFIE':
        case 'MODIFIÉ':
            return 'badge-warning';

        case 'REJETEE':
        case 'REJETÉE':
        case 'URGENTE':
        case 'ANNULE':
        case 'ANNULÉ':
            return 'badge-danger';

        case 'SOUMISE':
        case 'SOUMIS':
        case 'NORMALE':
        case 'NON':
            return 'badge-neutral';

        default:
            return 'badge-info';
    }
};

module.exports = {
    formatDate,
    formatDateTime,
    truncate,
    formatEnumLabel,
    badgeClassFor,
};