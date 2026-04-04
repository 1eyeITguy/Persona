"""Initial schema — tenants and persona_users.

Revision ID: 0001
Revises:
Create Date: 2026-04-04
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenants",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("slug", sa.String(64), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column(
            "deployment_mode", sa.String(16), nullable=False, server_default="single"
        ),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("created_at", sa.String(32), nullable=False),
    )
    op.create_index("ix_tenants_slug", "tenants", ["slug"], unique=True)

    op.create_table(
        "persona_users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False),
        sa.Column("username", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.String(64), nullable=False),
        sa.Column(
            "is_local_admin", sa.Boolean(), nullable=False, server_default="0"
        ),
        sa.Column("created_at", sa.String(32), nullable=False),
        sa.Column("last_login", sa.String(32), nullable=True),
        sa.UniqueConstraint(
            "tenant_id", "username", name="uq_persona_users_tenant_username"
        ),
    )
    op.create_index(
        "ix_persona_users_tenant_id", "persona_users", ["tenant_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_persona_users_tenant_id", table_name="persona_users")
    op.drop_table("persona_users")
    op.drop_index("ix_tenants_slug", table_name="tenants")
    op.drop_table("tenants")
